# yafmcp

Servidor **MCP** para operar um servidor **FiveM**: o agente manda um comando, o comando
entra no console do FXServer e a saída do console volta como resposta.

Funciona com qualquer cliente MCP — Claude Code, Hermes, Codex, OpenCode, ou o que vier
depois — porque é MCP por stdio puro (e HTTP streamable quando você quiser).

## Como ele fala com o servidor

Pelo **live console do txAdmin** (v7/v8): login por senha em `/auth/password`, sessão
guardada em cookie, e o comando vai pelo socket.io na sala `liveconsole`, exatamente
como a aba Live Console do painel faz. A saída é capturada do stream `consoleData`,
limpa de ANSI e devolvida.

Não precisa de `rcon_password`, não precisa reiniciar o servidor, não precisa de acesso
ao container.

> O socket.io do txAdmin só responde por **long-polling**: o servidor HTTP que escuta na
> porta do painel roteia `/socket.io` para `engine.handleRequest`, e não trata upgrade de
> websocket. O cliente aqui já vem fixado em `polling` por causa disso.

## Instalação

Pelo npm, sem clonar nada:

```bash
npx -y yafmcp --setup     # grava as credenciais do txAdmin
npx -y yafmcp --doctor    # confere a conexão
```

Ou do repositório, para mexer no código:

```bash
git clone https://github.com/ggfto/yafmcp.git
cd yafmcp
npm install
npm run setup     # pergunta URL do txAdmin, usuário e senha; grava 600 em ~/.config/yafmcp/config.json
npm run doctor    # loga, conecta no console e roda um "version"
```

Requer Node 18+ (testado no 22) e um admin do txAdmin com permissão de console
(`console.view` + `console.write`; o master já tem).

### Configuração

`~/.config/yafmcp/config.json` (ou variáveis de ambiente, que têm precedência):

| Campo | Env | Padrão |
| --- | --- | --- |
| `txadminUrl` | `FIVEM_TXADMIN_URL` | `http://127.0.0.1:40120` |
| `serverUrl` | `FIVEM_SERVER_URL` | `http://127.0.0.1:30120` |
| `username` | `FIVEM_TXADMIN_USER` | — |
| `password` | `FIVEM_TXADMIN_PASS` | — |
| `quietMs` | `FIVEM_QUIET_MS` | `900` — silêncio no console que fecha a captura |
| `timeoutMs` | `FIVEM_TIMEOUT_MS` | `10000` — teto da captura |
| `scrollback` | — | `2000` linhas guardadas em memória |

## Registrando nos agentes

```bash
node src/register.js          # registra em todos os clientes presentes na máquina
node src/register.js --print  # só imprime os trechos, você cola onde quiser
```

Ou na mão:

Em todos os exemplos abaixo, `npx -y yafmcp` e `node /caminho/yafmcp/src/index.js`
são intercambiáveis — o primeiro dispensa clone, o segundo usa a sua cópia local.

```bash
# Claude Code
claude mcp add --scope user fivem -- npx -y yafmcp
```

```toml
# Codex — ~/.codex/config.toml
[mcp_servers.fivem]
command = "node"
args = ["/caminho/yafmcp/src/index.js"]
```

```json
// OpenCode — ~/.config/opencode/opencode.json
{ "mcp": { "fivem": { "type": "local", "command": ["node", "/caminho/yafmcp/src/index.js"], "enabled": true } } }
```

```yaml
# Hermes — ~/.hermes/config.yaml
mcp_servers:
  fivem:
    command: node
    args:
      - /caminho/yafmcp/src/index.js
    enabled: true
```

## Ferramentas

| Ferramenta | O que faz |
| --- | --- |
| `fivem_command` | Executa qualquer comando no console e devolve a saída. `timeoutMs`, `quietMs` e `timestamps` são opcionais. |
| `fivem_console` | Últimas linhas do console capturadas pela sessão, com `filter` por regex. |
| `fivem_status` | No ar?, hostname, jogadores, game build, nº de resources. |
| `fivem_players` | Jogadores online com id, ping e identificadores. |
| `fivem_server_control` | `start` / `stop` / `restart` do processo do servidor (derruba quem estiver online). |

```
> reinicia o resource mri_Qadmin
  fivem_command("restart mri_Qadmin")
  $ restart mri_Qadmin
  [   script:mri_Qadmin] Stopping resource mri_Qadmin
  [   script:mri_Qadmin] Started resource mri_Qadmin
```

## Outros modos

```bash
node src/index.js                   # MCP stdio (o normal)
node src/index.js --http --port 8765  # MCP streamable HTTP em /mcp, para clientes que falam por URL
node src/index.js --exec "refresh"  # um comando direto pelo terminal, sem agente no meio
node src/index.js --doctor          # diagnóstico da conexão
```

## Agente dedicado no Clink (opcional)

Quem usa o [Clink](https://github.com/ggfto/clink) pode criar um tipo de agente
**FiveM Ops** — mission + rule sheet — que nasce sabendo operar o servidor:

```bash
node tools/clink-agent.js
clink new "FiveM Ops" "FiveM"
```

`FIVEM_DEFAULT_PATH` escolhe a pasta em que esse agente abre (padrão `~/fx-panel`).

## Segurança

Nenhum comando é bloqueado: quem tem o MCP tem o console do servidor inteiro. A senha
fica só no arquivo de config (modo 600) ou no ambiente — nunca no repositório, nunca no
prompt do agente. Se isso for demais para o seu caso, dê ao MCP um admin do txAdmin com
permissões reduzidas: a checagem de permissão é feita pelo próprio txAdmin.

## Publicando o pacote

`.github/workflows/publish.yml` roda ao publicar uma **release** no GitHub (ou pela aba
Actions) e manda o mesmo código para os dois registries:

- **npmjs.com** como `yafmcp`, público — precisa do segredo `NPM_TOKEN` (token de
  automação da sua conta npm) em Settings → Secrets → Actions.
- **GitHub Packages** como `@<owner>/yafmcp` — usa o `GITHUB_TOKEN` do próprio job, sem
  segredo nenhum.

Antes de publicar, suba a versão (`npm version patch|minor|major`), empurre a tag e crie
a release. `.github/workflows/ci.yml` roda os testes em cada push, no Node 20 e 22.

## Licença

MIT.
