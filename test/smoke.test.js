import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { cleanConsole } from '../src/txadmin.js';
import { buildServer } from '../src/index.js';

const ESC = '';

test('cleanConsole tira ANSI, título OSC e o marcador de tempo do txAdmin', () => {
  const raw = `${ESC}]0;titulo{§67e3d1c0}${ESC}[36mola${ESC}[0m mundo\r\n`;
  assert.equal(cleanConsole(raw), 'ola mundo\n');
});

test('cleanConsole com timestamps traduz o marcador para hora', () => {
  const out = cleanConsole('{§67e3d1c0}linha', { timestamps: true });
  assert.match(out, /^\[\d{2}:\d{2}:\d{2}\] linha$/);
});

/** Cliente falso: nada aqui fala com um servidor FiveM de verdade. */
const stubTx = {
  runCommand: async (command) => ({ command, output: `saida de ${command}`, tookMs: 12, truncatedByTimeout: false }),
  connect: async () => ({}),
  tail: () => 'linha antiga',
  api: async () => ({ type: 'success', msg: 'ok' }),
};

const cfg = { txadminUrl: 'http://tx.invalid', serverUrl: 'http://fx.invalid', quietMs: 10, timeoutMs: 50 };

async function connectedClient() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([buildServer(cfg, stubTx).connect(serverSide), client.connect(clientSide)]);
  return client;
}

test('o servidor MCP expõe as cinco ferramentas', async () => {
  const client = await connectedClient();
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ['fivem_command', 'fivem_console', 'fivem_players', 'fivem_server_control', 'fivem_status']
  );
  await client.close();
});

test('fivem_command devolve a saída do console', async () => {
  const client = await connectedClient();
  const res = await client.callTool({ name: 'fivem_command', arguments: { command: 'version' } });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /\$ version\nsaida de version/);
  await client.close();
});

test('fivem_command sem comando é recusado pelo schema', async () => {
  const client = await connectedClient();
  const res = await client.callTool({ name: 'fivem_command', arguments: { command: '' } });
  assert.equal(res.isError, true);
  await client.close();
});

test('fivem_server_control só aceita start/stop/restart', async () => {
  const client = await connectedClient();
  const ok = await client.callTool({ name: 'fivem_server_control', arguments: { action: 'restart' } });
  assert.equal(ok.content[0].text, 'ok');
  const bad = await client.callTool({ name: 'fivem_server_control', arguments: { action: 'explode' } });
  assert.equal(bad.isError, true);
  await client.close();
});
