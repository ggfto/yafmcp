O servidor FiveM é o container `fivem` do stack **fx-panel** (txAdmin v8 em
`http://127.0.0.1:40120`, FXServer em `:30120`, painel em `:8080`). Todo comando
entra pelo MCP **`fivem`** — nunca por `docker attach`, nem editando cfg na mão.

## Ferramentas

| Ferramenta | Para quê |
| --- | --- |
| `fivem_command` | Qualquer comando do console e a saída dele. É a ferramenta padrão. |
| `fivem_console` | Reler o que passou no console (`filter` aceita regex) — use depois de um comando que continua imprimindo. |
| `fivem_status` | Está no ar? quantos jogadores, game build, quantos resources. |
| `fivem_players` | Lista de jogadores com id, ping e identificadores. |
| `fivem_server_control` | `start` / `stop` / `restart` do processo do servidor. Derruba todo mundo — só com pedido explícito. |

Sem MCP disponível, o mesmo comando sai por
`node ~/yafmcp/src/index.js --exec "<comando>"`.

## Como responder

Devolva a saída do console **literal**, sem reescrever. Se o console não imprimiu
nada, diga isso — não invente resultado. `No such command X` quer dizer que o
comando não existe nessa build, não que falhou.

A captura fecha quando o console fica quieto (~900ms). Comando que demora a
responder (`refresh` num servidor grande, `ensure` de resource pesado) pede
`timeoutMs` maior; se vier `[saída cortada pelo timeout]`, complete com
`fivem_console`.

## Comandos que aparecem sempre

```
ensure <resource>        # (re)carrega um resource — o padrão para "recarrega o X"
refresh                  # relê a lista de resources do disco; antes de ensure em coisa nova
stop <resource>          # para um resource (ensure não para nada)
say <mensagem>           # chat global
status / players         # prefira fivem_status e fivem_players
<convar>                 # imprime valor atual, ex.: sv_enforceGameBuild
set <convar> <valor>     # convar de servidor; setr para replicado no cliente
```

Prefira `ensure` a `start`/`restart`: ele cobre os dois casos e não erra por causa do
estado em que o resource estava. `start` e `restart` ficam para quando falhar no outro
caso é o sinal que você quer — `restart` num resource parado reclama, e às vezes é
exatamente essa a informação. `fivem_server_control restart` é outra coisa: reinicia o
servidor inteiro e desconecta todos.

## Onde as coisas moram

- `~/fx-panel/server-data/server.cfg` — cfg do servidor (o txAdmin é quem dá `exec`).
- `~/fx-panel/server-data/resources/` — resources.
- `~/fx-panel/txdata/default/logs/fxserver.log` — console em arquivo.
- Banco: MariaDB no container `fivem-db` (`mri_Qbox`).

Alterar cfg ou resource **não** entra em vigor sozinho: depois de mexer, rode
`refresh` e `ensure <resource>`.
