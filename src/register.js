#!/usr/bin/env node
/**
 * Registra o yafmcp nos clientes MCP da máquina.
 *
 *   node src/register.js            # todos os clientes que existirem aqui
 *   node src/register.js --claude --hermes
 *   node src/register.js --print    # só mostra os trechos de config, não escreve
 *
 * O servidor é sempre o mesmo binário stdio; o que muda é o formato do arquivo
 * de cada agente.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ENTRY = resolve(fileURLToPath(new URL('./index.js', import.meta.url)));
const NAME = 'fivem';
const HOME = homedir();

const has = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;
const run = (bin, args) => spawnSync(bin, args, { encoding: 'utf8' });

const SNIPPETS = {
  claude: `claude mcp add --scope user ${NAME} -- node ${ENTRY}`,
  codex: `# ~/.codex/config.toml\n[mcp_servers.${NAME}]\ncommand = "node"\nargs = ["${ENTRY}"]`,
  opencode: `// ~/.config/opencode/opencode.json(c)\n"mcp": {\n  "${NAME}": { "type": "local", "command": ["node", "${ENTRY}"], "enabled": true }\n}`,
  hermes: `hermes mcp add ${NAME} --command node --args ${ENTRY}`,
};

const results = [];
const note = (target, status, detail) => results.push({ target, status, detail });

function registerClaude() {
  if (!has('claude')) return note('claude-code', 'pulado', 'CLI "claude" não encontrada');
  const res = run('claude', ['mcp', 'add', '--scope', 'user', NAME, '--', 'node', ENTRY]);
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
  if (res.status === 0) return note('claude-code', 'ok', out.split('\n')[0] || 'registrado');
  if (/already exists/i.test(out)) return note('claude-code', 'ok', 'já estava registrado');
  note('claude-code', 'falhou', out.split('\n')[0]);
}

function registerHermes() {
  // `hermes mcp add` é interativo (discovery-first) e cancela sem TTY, então a
  // entrada vai direto no config.yaml — inserida como texto para não perder os
  // comentários que o arquivo tem.
  const path = join(HOME, '.hermes', 'config.yaml');
  if (!existsSync(path)) return note('hermes', 'pulado', 'sem ~/.hermes/config.yaml');
  const raw = readFileSync(path, 'utf8');
  if (new RegExp(`^  ${NAME}:`, 'm').test(raw)) return note('hermes', 'ok', 'já estava registrado');

  const block = `  ${NAME}:\n    command: node\n    args:\n      - ${ENTRY}\n    enabled: true\n`;
  let next;
  if (/^mcp_servers:\s*$/m.test(raw)) {
    next = raw.replace(/^mcp_servers:\s*$/m, (line) => `${line}\n${block.replace(/\n$/, '')}`);
  } else {
    next = `${raw.replace(/\s*$/, '\n')}\nmcp_servers:\n${block}`;
  }
  writeFileSync(`${path}.bak-yafmcp`, raw);
  writeFileSync(path, next);
  note('hermes', 'ok', `${path} (backup em ${path}.bak-yafmcp)`);
}

function registerCodex() {
  const path = join(HOME, '.codex', 'config.toml');
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (current.includes(`[mcp_servers.${NAME}]`)) return note('codex', 'ok', 'já estava registrado');
  const block = `\n[mcp_servers.${NAME}]\ncommand = "node"\nargs = ["${ENTRY}"]\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, current.replace(/\s*$/, '\n') + block);
  note('codex', 'ok', path);
}

function registerOpencode() {
  const dir = join(HOME, '.config', 'opencode');
  const path = ['opencode.jsonc', 'opencode.json']
    .map((f) => join(dir, f))
    .find((f) => existsSync(f)) ?? join(dir, 'opencode.json');
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
  // Comentário no arquivo é legítimo em .jsonc, mas reescrever com JSON.stringify
  // os apagaria — nesse caso o registro fica manual.
  if (/^\s*\/\//m.test(raw) || /\/\*/.test(raw)) {
    return note('opencode', 'manual', `${path} tem comentários; use o trecho abaixo`);
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (err) {
    return note('opencode', 'falhou', `${path}: ${err.message}`);
  }
  cfg.mcp = cfg.mcp ?? {};
  cfg.mcp[NAME] = { type: 'local', command: ['node', ENTRY], enabled: true };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
  note('opencode', 'ok', path);
}

const flags = process.argv.slice(2);
const wanted = flags.filter((f) => f.startsWith('--')).map((f) => f.slice(2));
const want = (t) => wanted.length === 0 || wanted.includes(t);

if (wanted.includes('print')) {
  for (const [target, snippet] of Object.entries(SNIPPETS)) {
    console.log(`\n### ${target}\n${snippet}`);
  }
  process.exit(0);
}

if (want('claude')) registerClaude();
if (want('hermes')) registerHermes();
if (want('codex')) registerCodex();
if (want('opencode')) registerOpencode();

console.log(`yafmcp: ${ENTRY}\n`);
for (const r of results) {
  console.log(`${r.target.padEnd(12)} ${r.status.padEnd(7)} ${r.detail ?? ''}`);
  if (r.status === 'manual' || r.status === 'pulado') {
    console.log(`${''.padEnd(12)}         ${SNIPPETS[r.target.replace('claude-code', 'claude')] ?? ''}`);
  }
}
