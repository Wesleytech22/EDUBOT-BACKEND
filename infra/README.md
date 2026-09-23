# Infra — Sprints 02 a 04

Ambiente de teste para as dependências externas do EduBot (RF-01 a RF-03,
dependências da seção 5.9 do Documento de Escopo): PostgreSQL, N8N e WAHA.

Nesta Sprint o objetivo é apenas ter os três contêineres de pé e estáveis —
nenhum workflow de broadcast é desenhado no N8N ainda (fica para a Sprint 03).

## Como subir

```bash
cd infra
cp .env.example .env   # ajuste usuário/senha antes de expor a instância
docker compose up -d
```

| Serviço | Porta padrão | Acesso |
|---|---|---|
| PostgreSQL | 5432 | usado pelo backend (`../`), ver `.env.example` da raiz |
| N8N | 5678 | http://localhost:5678 (basic auth) |
| WAHA | 3001 | http://localhost:3001 — conectar o número de WhatsApp dedicado escaneando o QR code em `/api/sessions` |

## Workflow de broadcast (Sprint 03)

O workflow do N8N fica versionado em `n8n/broadcast-mock.json` (webhook
`POST /webhook/broadcast` → monta a lista de contatos → simula o envio da
WAHA → callback em `POST /api/webhooks/n8n/dispatch-status`). Depois de subir
os contêineres pela primeira vez, importe e ative:

```bash
docker compose cp n8n/broadcast-mock.json n8n:/tmp/wf.json
docker compose exec n8n n8n import:workflow --input=/tmp/wf.json
docker compose exec n8n n8n update:workflow --id=sPCtekMhtu4pQ9IA --active=true
docker compose restart n8n
```

O header `X-Webhook-Secret` do callback vem da variável `N8N_WEBHOOK_SECRET`
deste `.env` (repassada ao N8N como `EDUBOT_WEBHOOK_SECRET`) e precisa ser
igual ao `N8N_WEBHOOK_SECRET` do `.env` da raiz do backend — senão o callback
recebe 401 e os envios ficam presos em "pendente". Na raiz, o backend aponta
para `N8N_WEBHOOK_URL=http://localhost:5678/webhook/broadcast`.

Se o Docker Desktop estiver desligado, o disparo não é desfeito, mas todos os
logs ficam como "falha" com o motivo "Falha ao contatar o N8N". Depois de
subir o ambiente, use "Reenviar para quem falhou" na tela de Resultado do
Disparo (RF-32).

## Workflow do chatbot (Sprint 04)

`n8n/chatbot-inbound.json` recebe os eventos da WAHA em `POST /webhook/waha`
(`WAHA_HOOK_URL`), ignora mensagens do próprio número e de grupos, chama o
backend em `POST /api/webhooks/whatsapp/inbound` (opt-in/opt-out, MENU, FAQ,
atendente — RF-07 a RF-11) e responde ao contato pela WAHA (`/api/sendText`).
Importe e ative como o de broadcast:

```bash
docker compose cp n8n/chatbot-inbound.json n8n:/tmp/in.json
docker compose exec n8n n8n import:workflow --input=/tmp/in.json
docker compose exec n8n n8n update:workflow --id=EduBotInboundWA1 --active=true
docker compose restart n8n
```

Para testar sem WhatsApp pareado, envie um payload simples — o webhook
devolve a resposta do chatbot (`reply`) e se a WAHA conseguiu entregar:

```bash
curl -X POST http://localhost:5678/webhook/waha -H "Content-Type: application/json"   -d '{"phone":"+5511999990001","message":"MENU"}'
```

Enquanto a sessão da WAHA não estiver `WORKING`, `enviadoPelaWaha` volta
`false` (a resposta é gerada e registrada normalmente, só não chega ao celular).

## Notas

- Os dados de cada serviço persistem em volumes nomeados (`postgres_data`,
  `n8n_data`, `waha_data`); `docker compose down -v` apaga tudo.
- As credenciais deste arquivo são apenas para o ambiente de teste local —
  nunca reutilize em produção (RNF-08).
- Depois de subir o Postgres, rode as migrations do backend normalmente
  (`npm run migrate` na raiz do repositório).
- O container do N8N precisa de `extra_hosts: host.docker.internal:host-gateway`
  para conseguir chamar de volta o backend rodando fora do Docker (callback de
  `POST /api/webhooks/n8n/dispatch-status`, RF-06). Sem isso o N8N recebe
  `ENOTFOUND` ao tentar acessar `host.docker.internal`.
- O engine padrão da WAHA está fixado em `WHATSAPP_DEFAULT_ENGINE=GOWS`
  (whatsmeow) — os engines `WEBJS` (trava no refresh do QR) e `NOWEB`
  (Baileys) foram testados e descartados.
- **Pendência conhecida:** o pareamento de um WhatsApp real via QR code vem
  sendo bloqueado pelo próprio WhatsApp (erro "verifique sua conexão" no
  celular), testado nos três engines e em duas redes diferentes — não é bug
  da nossa infra, é uma medida anti-abuso contra bibliotecas não-oficiais
  (Baileys/whatsmeow/whatsapp-web.js). O fluxo de broadcast (Sprint 03) foi
  validado ponta a ponta com um workflow de N8N que simula o envio (mock),
  sem depender do WhatsApp real estar conectado.
