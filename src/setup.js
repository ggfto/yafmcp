#!/usr/bin/env node
/**
 * Grava ~/.config/fivem-mcp/config.json com as credenciais do txAdmin.
 * A senha é digitada escondida e o arquivo nasce com permissão 600.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { CONFIG_PATH } from './config.js';

function ask(question, { hidden = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    if (hidden) {
      const onData = (char) => {
        if ([`\n`, `\r`, '\x04'].includes(String(char))) process.stdin.removeListener('data', onData);
        else process.stdout.write('\x1b[2K\x1b[200D' + question + '*'.repeat(rl.line.length));
      };
      process.stdin.on('data', onData);
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const current = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) : {};

console.log(`Configurando ${CONFIG_PATH}`);
console.log('Use um admin do txAdmin com permissão de console (o master serve).\n');

const txadminUrl =
  (await ask(`URL do txAdmin [${current.txadminUrl ?? 'http://127.0.0.1:40120'}]: `)) ||
  current.txadminUrl ||
  'http://127.0.0.1:40120';
const serverUrl =
  (await ask(`URL do FXServer [${current.serverUrl ?? 'http://127.0.0.1:30120'}]: `)) ||
  current.serverUrl ||
  'http://127.0.0.1:30120';
const username = (await ask(`Usuário do txAdmin${current.username ? ` [${current.username}]` : ''}: `)) || current.username;
const password = (await ask('Senha: ', { hidden: true })) || current.password;

if (!username || !password) {
  console.error('Usuário e senha são obrigatórios.');
  process.exit(1);
}

mkdirSync(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
writeFileSync(
  CONFIG_PATH,
  JSON.stringify({ ...current, txadminUrl, serverUrl, username, password }, null, 2) + '\n',
  { mode: 0o600 }
);
chmodSync(CONFIG_PATH, 0o600);
console.log(`\nSalvo em ${CONFIG_PATH} (600). Teste com: npm run doctor`);
