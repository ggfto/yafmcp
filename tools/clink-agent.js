#!/usr/bin/env node
/**
 * Cria (ou atualiza) no Clink o tipo de agente "FiveM Ops" e a rule sheet
 * `fivem-ops`, falando com o servidor pela mesma API que o painel usa — assim
 * a mudança entra no servidor que já está rodando, sem `clink restart`.
 *
 *   node tools/clink-agent.js            # aplica
 *   node tools/clink-agent.js --dry-run  # só mostra o que faria
 */
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = process.env.CLINK_PORT || '5000';
const URL_WS = process.env.CLINK_URL
  ? process.env.CLINK_URL.replace(/^http/, 'ws')
  : `ws://127.0.0.1:${PORT}`;

const LABEL = 'FiveM Ops';
const SKILL_SLUG = 'fivem-ops';
const SKILL_DESC =
  'Use ao operar o servidor FiveM do fx-panel: rodar comandos no console, reiniciar resources, ver jogadores ou investigar erro no servidor.';
const SKILL_BODY = readFileSync(resolve(HERE, 'fivem-ops.skill.md'), 'utf8');
const MISSION = readFileSync(resolve(HERE, 'fivem-ops.mission.txt'), 'utf8').trim();

const AGENT = {
  presetId: 'claude-code',
  label: LABEL,
  icon: '/img/claude-code.png',
  command: 'claude --permission-mode auto',
  enabled: true,
  defaultPath: process.env.FIVEM_DEFAULT_PATH || resolve(process.env.HOME || '.', 'fx-panel'),
  isAgent: true,
  canResume: true,
  resumeCommand: 'claude --resume {{sessionId}}',
  autoApprove: false,
  autoApproveFlag: '--dangerously-skip-permissions',
  sessionIdPattern:
    'Session ID:\\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
  outputMarker: '⏺',
  env: {},
  model: '',
  mission: MISSION,
  skills: [SKILL_SLUG],
  telemetryEnabled: true,
  telemetrySetupConsent: true,
  telemetryStatus: { ok: true },
  userAdded: true,
};

const dryRun = process.argv.includes('--dry-run');
if (dryRun) {
  console.log(JSON.stringify({ agent: AGENT, skill: { slug: SKILL_SLUG, description: SKILL_DESC } }, null, 2));
  process.exit(0);
}

const ws = new WebSocket(URL_WS);
let config = null;
let done = false;

const send = (msg) => ws.send(JSON.stringify(msg));

ws.on('open', () => {});

ws.on('message', (data) => {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch {
    return;
  }

  if (msg.type === 'error') console.error(`clink: ${msg.message}`);
  if (msg.type === 'config') {
    if (!config) {
      config = msg.config;
      apply();
    } else if (!done) {
      // Segunda vez: é o broadcast depois do nosso config.update.
      const saved = (msg.config.commands ?? []).find((c) => c.label === LABEL);
      done = true;
      console.log(
        saved
          ? `agente "${LABEL}" gravado (id ${saved.id}, skills: ${saved.skills?.join(', ') || 'nenhuma'})`
          : `config.update aplicado, mas "${LABEL}" não apareceu na lista — confira o painel`
      );
      ws.close();
    }
  }
});

function apply() {
  // prevSlug igual ao slug = "salva por cima": sem ele o store recusa um slug
  // que já existe, e rodar isto duas vezes deixaria de atualizar a rule sheet.
  send({ type: 'skill.save', slug: SKILL_SLUG, description: SKILL_DESC, body: SKILL_BODY, prevSlug: SKILL_SLUG });
  send({ type: 'skill.setEnabled', slug: SKILL_SLUG, enabled: true });

  const commands = [...(config.commands ?? [])];
  const idx = commands.findIndex((c) => c.label === LABEL);
  const entry = { ...AGENT, id: idx >= 0 ? commands[idx].id : randomUUID() };
  if (idx >= 0) commands[idx] = { ...commands[idx], ...entry };
  else commands.push(entry);

  send({ type: 'config.update', config: { commands } });
}

ws.on('error', (err) => {
  console.error(`Não consegui falar com o servidor do Clink em ${URL_WS}: ${err.message}`);
  process.exit(1);
});

setTimeout(() => {
  if (!done) {
    console.error('Timeout esperando a confirmação do Clink.');
    process.exit(1);
  }
}, 15000).unref();
