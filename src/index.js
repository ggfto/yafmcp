#!/usr/bin/env node
/**
 * fivem-mcp — servidor MCP para operar o servidor FiveM.
 *
 * Os comandos entram no console do FXServer pelo live console do txAdmin
 * (socket.io, sala "liveconsole") e a saída do console volta como resposta.
 *
 * Modos:
 *   node src/index.js              # MCP por stdio (qualquer cliente MCP)
 *   node src/index.js --http       # MCP por HTTP streamable (padrão: 127.0.0.1:8765)
 *   node src/index.js --doctor     # testa credenciais/conexão e sai
 *   node src/index.js --exec "..." # roda um comando direto pelo terminal e sai
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { loadConfig, CONFIG_PATH } from './config.js';
import { TxAdminClient } from './txadmin.js';

const VERSION = '1.0.0';

function parseArgs(argv) {
  const args = { mode: 'stdio', host: '127.0.0.1', port: 8765, exec: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--http') args.mode = 'http';
    else if (a === '--doctor') args.mode = 'doctor';
    else if (a === '--exec') {
      args.mode = 'exec';
      args.exec = argv[++i];
    } else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--host') args.host = argv[++i];
  }
  return args;
}

async function fetchJson(url, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const text = (s) => ({ content: [{ type: 'text', text: s || '(sem saída)' }] });
const fail = (s) => ({ content: [{ type: 'text', text: s }], isError: true });

export function buildServer(cfg, tx) {
  const server = new McpServer(
    { name: 'fivem-mcp', version: VERSION },
    {
      instructions:
        'Operação do servidor FiveM. fivem_command executa qualquer comando no console do ' +
        'FXServer (via live console do txAdmin) e devolve a saída do console. Use fivem_status ' +
        'e fivem_players para leitura rápida, fivem_console para reler o que já passou, e ' +
        'fivem_server_control apenas para start/stop/restart do processo do servidor.',
    }
  );

  server.registerTool(
    'fivem_command',
    {
      title: 'Executar comando no console do FiveM',
      description:
        'Executa um comando no console do FXServer e devolve o que o console imprimiu. ' +
        'Aceita qualquer comando do servidor (status, refresh, ensure/restart/stop <resource>, ' +
        'say, kick, set/setr <var> <valor>, svgm, etc.). A captura fecha quando o console fica ' +
        'quieto; comandos que demoram para responder pedem timeoutMs maior.',
      inputSchema: {
        command: z.string().min(1).describe('Comando exatamente como se digitasse no console'),
        timeoutMs: z.number().int().min(500).max(120000).optional()
          .describe('Tempo máximo de captura da saída (padrão 10000)'),
        quietMs: z.number().int().min(100).max(30000).optional()
          .describe('Silêncio no console que encerra a captura (padrão 900)'),
        timestamps: z.boolean().optional().describe('Prefixar cada bloco com o horário'),
      },
    },
    async ({ command, timeoutMs, quietMs, timestamps }) => {
      try {
        const res = await tx.runCommand(command, { timeoutMs, quietMs, timestamps });
        const header = `$ ${res.command}`;
        const foot = res.truncatedByTimeout
          ? '\n\n[saída cortada pelo timeout — o comando pode ainda estar rodando]'
          : '';
        return text(`${header}\n${res.output || '(o console não imprimiu nada)'}${foot}`);
      } catch (err) {
        return fail(`Falha ao executar "${command}": ${err.message}`);
      }
    }
  );

  server.registerTool(
    'fivem_console',
    {
      title: 'Ler o console do FiveM',
      description:
        'Últimas linhas do console do servidor capturadas por esta sessão, com filtro opcional ' +
        'por regex. Use depois de um comando que continua imprimindo, ou para investigar erros.',
      inputSchema: {
        lines: z.number().int().min(1).max(2000).optional().describe('Quantas linhas (padrão 80)'),
        filter: z.string().optional().describe('Regex case-insensitive para filtrar as linhas'),
      },
    },
    async ({ lines, filter }) => {
      try {
        await tx.connect();
        return text(tx.tail({ lines, filter }));
      } catch (err) {
        return fail(`Falha ao ler o console: ${err.message}`);
      }
    }
  );

  server.registerTool(
    'fivem_status',
    {
      title: 'Status do servidor FiveM',
      description:
        'Estado do servidor: se está no ar, hostname, jogadores online, slots, game build e ' +
        'quantidade de resources. Lê os endpoints públicos do próprio FXServer.',
      inputSchema: {},
    },
    async () => {
      try {
        const [info, dynamic] = await Promise.all([
          fetchJson(`${cfg.serverUrl}/info.json`),
          fetchJson(`${cfg.serverUrl}/dynamic.json`),
        ]);
        const vars = info.vars ?? {};
        return text(
          [
            `online: sim`,
            `hostname: ${dynamic.hostname}`,
            `jogadores: ${dynamic.clients}/${dynamic.sv_maxclients}`,
            `game build: ${vars.sv_enforceGameBuild ?? '(padrão)'}`,
            `locale: ${vars.locale ?? '-'}`,
            `resources: ${(info.resources ?? []).length}`,
            `txadmin: ${cfg.txadminUrl}`,
          ].join('\n')
        );
      } catch (err) {
        return text(`online: não (${err.message})\ntxadmin: ${cfg.txadminUrl}`);
      }
    }
  );

  server.registerTool(
    'fivem_players',
    {
      title: 'Jogadores conectados',
      description: 'Lista os jogadores online com id, nome, ping e identificadores.',
      inputSchema: {},
    },
    async () => {
      try {
        const players = await fetchJson(`${cfg.serverUrl}/players.json`);
        if (!players.length) return text('Nenhum jogador conectado.');
        const rows = players.map(
          (p) => `#${p.id} ${p.name} — ping ${p.ping}ms — ${(p.identifiers ?? []).join(' ')}`
        );
        return text(`${players.length} jogador(es):\n${rows.join('\n')}`);
      } catch (err) {
        return fail(`Falha ao listar jogadores: ${err.message}`);
      }
    }
  );

  server.registerTool(
    'fivem_server_control',
    {
      title: 'Controlar o processo do servidor',
      description:
        'start, stop ou restart do FXServer pelo txAdmin. Derruba todo mundo que estiver online — ' +
        'para recarregar um resource use fivem_command com "restart <resource>".',
      inputSchema: {
        action: z.enum(['start', 'stop', 'restart']).describe('Ação no processo do servidor'),
      },
    },
    async ({ action }) => {
      try {
        const res = await tx.api('/fxserver/controls', { action });
        if (res.type === 'error') return fail(`txAdmin recusou: ${res.msg}`);
        return text(res.msg ?? JSON.stringify(res));
      } catch (err) {
        return fail(`Falha no ${action}: ${err.message}`);
      }
    }
  );

  return server;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    console.error(`[fivem-mcp] ${err.message}`);
    process.exit(78); // EX_CONFIG
  }
  const tx = new TxAdminClient(cfg);

  if (args.mode === 'doctor') {
    console.log(`config:  ${CONFIG_PATH}`);
    console.log(`txadmin: ${cfg.txadminUrl}`);
    const admin = await tx.login();
    console.log(`login:   ok como "${admin.name}" (master: ${admin.isMaster})`);
    await tx.connect();
    console.log('console: conectado na sala liveconsole');
    const res = await tx.runCommand('version');
    console.log(`comando: "version" respondeu em ${res.tookMs}ms\n${res.output}`);
    tx.close();
    return;
  }

  if (args.mode === 'exec') {
    const res = await tx.runCommand(args.exec);
    console.log(res.output);
    tx.close();
    return;
  }

  const server = buildServer(cfg, tx);

  if (args.mode === 'http') {
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );
    const { randomUUID } = await import('node:crypto');
    const http = await import('node:http');

    const transports = new Map();
    const httpServer = http.createServer(async (req, res) => {
      if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404).end('not found');
        return;
      }
      const sessionId = req.headers['mcp-session-id'];
      let transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => transports.set(id, transport),
        });
        transport.onclose = () => {
          if (transport.sessionId) transports.delete(transport.sessionId);
        };
        await buildServer(cfg, tx).connect(transport);
      }
      let body;
      if (req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          body = undefined;
        }
      }
      await transport.handleRequest(req, res, body);
    });
    httpServer.listen(args.port, args.host, () => {
      console.error(`[fivem-mcp] MCP em http://${args.host}:${args.port}/mcp`);
    });
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[fivem-mcp] pronto (stdio)');
}

main().catch((err) => {
  console.error(`[fivem-mcp] erro fatal: ${err.stack ?? err.message}`);
  process.exit(1);
});
