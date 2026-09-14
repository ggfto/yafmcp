import { io } from 'socket.io-client';

// A saída do console do txAdmin vem colorida e com marcadores de tempo próprios
// no formato {§<unix em hex>} no começo de cada bloco.
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const TX_TIME = /\{§([0-9a-f]+)\}/g;

export function cleanConsole(raw, { timestamps = false } = {}) {
  let text = String(raw).replace(OSC, '').replace(ANSI, '');
  text = text.replace(TX_TIME, (_, hex) => {
    if (!timestamps) return '';
    const d = new Date(parseInt(hex, 16) * 1000);
    return `[${d.toTimeString().slice(0, 8)}] `;
  });
  return text.replace(/\r/g, '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TxAdminClient {
  #cookies = new Map();
  #socket = null;
  #connecting = null;
  #scroll = [];
  #listeners = new Set();

  constructor(cfg) {
    this.cfg = cfg;
    this.admin = null;
    this.csrfToken = null;
  }

  // ---------------------------------------------------------------- auth ---
  #cookieHeader() {
    return [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  #storeCookies(res) {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) this.#cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  get isAuthed() {
    return Boolean(this.csrfToken && this.#cookies.size);
  }

  async login() {
    const res = await fetch(`${this.cfg.txadminUrl}/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.cfg.username, password: this.cfg.password }),
    });
    this.#storeCookies(res);
    const data = await res.json().catch(() => ({}));
    if (data.error) throw new Error(`Login no txAdmin falhou: ${data.error}`);
    if (!data.csrfToken) throw new Error('Login no txAdmin não devolveu csrfToken.');
    this.admin = { name: data.name, isMaster: data.isMaster, permissions: data.permissions };
    this.csrfToken = data.csrfToken;
    return this.admin;
  }

  async ensureAuth() {
    if (!this.isAuthed) await this.login();
    return this.admin;
  }

  /** POST numa rota autenticada do txAdmin, com um retry de login se a sessão caiu. */
  async api(path, body = {}, { retry = true } = {}) {
    await this.ensureAuth();
    const res = await fetch(`${this.cfg.txadminUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-txadmin-csrftoken': this.csrfToken,
        cookie: this.#cookieHeader(),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (data.logout && retry) {
      this.#reset();
      return this.api(path, body, { retry: false });
    }
    return data;
  }

  #reset() {
    this.csrfToken = null;
    this.#cookies.clear();
    this.admin = null;
    if (this.#socket) {
      this.#socket.removeAllListeners();
      this.#socket.disconnect();
      this.#socket = null;
    }
  }

  // ------------------------------------------------------- live console ---
  #push(chunk) {
    for (const fn of this.#listeners) fn(chunk);
    const lines = cleanConsole(chunk, { timestamps: true }).split('\n');
    if (this.#scroll.length && lines.length) {
      this.#scroll[this.#scroll.length - 1] += lines.shift();
    }
    this.#scroll.push(...lines);
    const max = this.cfg.scrollback ?? 2000;
    if (this.#scroll.length > max) this.#scroll.splice(0, this.#scroll.length - max);
  }

  /** Socket na sala "liveconsole": é ela que aceita o evento consoleCommand. */
  async connect() {
    if (this.#socket?.connected) return this.#socket;
    if (this.#connecting) return this.#connecting;

    this.#connecting = (async () => {
      await this.ensureAuth();
      const socket = io(this.cfg.txadminUrl, {
        // O txAdmin só roteia /socket.io para engine.handleRequest: não há handler
        // de upgrade no servidor HTTP que escuta, então websocket não fecha handshake.
        transports: ['polling'],
        query: { rooms: 'liveconsole' },
        extraHeaders: { cookie: this.#cookieHeader() },
        reconnection: false,
        timeout: 15000,
      });

      await new Promise((resolve, reject) => {
        const fail = (msg) => {
          socket.removeAllListeners();
          socket.disconnect();
          reject(new Error(msg));
        };
        socket.once('connect', resolve);
        socket.once('connect_error', (err) => fail(`Live console não conectou: ${err.message}`));
        socket.once('logout', (reason) => fail(`txAdmin recusou a sessão do websocket: ${reason}`));
        setTimeout(() => fail('Timeout conectando no live console do txAdmin.'), 15000);
      });

      socket.on('consoleData', (chunk) => this.#push(chunk));
      socket.on('logout', () => this.#reset());
      socket.on('disconnect', () => {
        this.#socket = null;
      });
      this.#socket = socket;
      // A sala manda o buffer recente assim que entra; deixa ele assentar antes
      // de qualquer comando, senão vira "resposta" do primeiro comando enviado.
      await sleep(400);
      return socket;
    })().finally(() => {
      this.#connecting = null;
    });

    return this.#connecting;
  }

  /**
   * Manda um comando pro console do FXServer e devolve o que saiu no console
   * enquanto ele rodava. Fecha a captura depois de `quietMs` sem linha nova.
   */
  async runCommand(command, opts = {}) {
    const quietMs = opts.quietMs ?? this.cfg.quietMs;
    const timeoutMs = opts.timeoutMs ?? this.cfg.timeoutMs;
    const socket = await this.connect();

    const chunks = [];
    let lastAt = Date.now();
    const collector = (chunk) => {
      chunks.push(chunk);
      lastAt = Date.now();
    };

    this.#listeners.add(collector);
    const startedAt = Date.now();
    try {
      socket.emit('consoleCommand', command);
      while (Date.now() - startedAt < timeoutMs) {
        await sleep(100);
        if (chunks.length && Date.now() - lastAt >= quietMs) break;
      }
    } finally {
      this.#listeners.delete(collector);
    }

    const output = cleanConsole(chunks.join(''), { timestamps: opts.timestamps ?? false });
    return {
      command,
      output: stripEcho(output, command),
      tookMs: Date.now() - startedAt,
      truncatedByTimeout: Date.now() - startedAt >= timeoutMs,
    };
  }

  /** Últimas linhas do console, já capturadas por este processo. */
  tail({ lines = 80, filter = null } = {}) {
    let out = this.#scroll;
    if (filter) {
      const re = new RegExp(filter, 'i');
      out = out.filter((l) => re.test(l));
    }
    return out.slice(-lines).join('\n');
  }

  close() {
    this.#reset();
  }
}

/** O txAdmin ecoa o próprio comando como primeira linha; ela não é resposta. */
function stripEcho(output, command) {
  const lines = output.split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  if (lines.length && lines[0].includes(command.trim())) lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}
