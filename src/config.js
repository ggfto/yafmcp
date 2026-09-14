import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_PATH =
  process.env.FIVEM_MCP_CONFIG || join(homedir(), '.config', 'fivem-mcp', 'config.json');

const DEFAULTS = {
  // Painel do txAdmin — é por ele que o comando entra no console do FXServer.
  txadminUrl: 'http://127.0.0.1:40120',
  // Endpoints públicos do próprio FXServer (info.json / dynamic.json / players.json).
  serverUrl: 'http://127.0.0.1:30120',
  username: '',
  password: '',
  // Janela de captura da saída: fecha depois de quietMs sem nenhuma linha nova,
  // ou no máximo timeoutMs depois do envio.
  quietMs: 900,
  timeoutMs: 10000,
  // Linhas de console guardadas em memória para fivem_console.
  scrollback: 2000,
};

function fromFile() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`Config inválida em ${CONFIG_PATH}: ${err.message}`);
  }
}

function fromEnv() {
  const env = {};
  const map = {
    FIVEM_TXADMIN_URL: 'txadminUrl',
    FIVEM_TXADMIN_USER: 'username',
    FIVEM_TXADMIN_PASS: 'password',
    FIVEM_SERVER_URL: 'serverUrl',
    FIVEM_QUIET_MS: 'quietMs',
    FIVEM_TIMEOUT_MS: 'timeoutMs',
  };
  for (const [key, field] of Object.entries(map)) {
    const raw = process.env[key];
    if (raw === undefined || raw === '') continue;
    env[field] = field.endsWith('Ms') ? Number(raw) : raw;
  }
  return env;
}

export function loadConfig() {
  const cfg = { ...DEFAULTS, ...fromFile(), ...fromEnv() };
  cfg.txadminUrl = String(cfg.txadminUrl).replace(/\/+$/, '');
  cfg.serverUrl = String(cfg.serverUrl).replace(/\/+$/, '');
  if (!cfg.username || !cfg.password) {
    throw new Error(
      `Faltam as credenciais do txAdmin. Preencha "username" e "password" em ${CONFIG_PATH} ` +
        `(ou exporte FIVEM_TXADMIN_USER / FIVEM_TXADMIN_PASS).`
    );
  }
  return cfg;
}
