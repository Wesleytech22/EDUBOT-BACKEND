# EduBot — Backend (Sprint 03)

API do Módulo Web de Gestão de Oportunidades e do Módulo B — Notificação em
Massa. Node.js + Express + PostgreSQL.

Escopo acumulado: Módulo A (RF-01 a RF-03), Módulo I (RF-20, RF-21) e, a
partir desta Sprint, Módulo B (RF-04 a RF-06) — broadcast via workflow do
N8N integrado à API do WAHA.

## Pré-requisitos

- Node.js 18+
- PostgreSQL 16 (pode ser o do `infra/docker-compose.yml`)
- N8N e WAHA — opcionais para rodar localmente. Sem `N8N_WEBHOOK_URL`
  configurada, o disparo continua funcionando e os `dispatch_logs` só
  nascem em `falha` em vez de `enviado` (dá pra testar o fluxo inteiro
  assim, sem subir as duas ferramentas).

## Como rodar

```bash
cp .env.example .env        # ajuste as credenciais se necessário
npm install
npm run migrate             # cria/atualiza as tabelas (users, opportunities, logs, contacts, dispatch_logs, ...)
npm run seed                # cria as contas de acesso e os contatos de teste do broadcast
npm run dev                 # inicia em http://localhost:4000
```

Contas criadas pelo seed (definidas em `.env`):

| Perfil | E-mail | Senha |
|---|---|---|
| Administrador | `coordenacao@escola.edu.br` | `EduBot@2026` |
| Equipe da Escola | `equipe@escola.edu.br` | `EduBot@2026` |

## Endpoints

| Método | Rota | Descrição | Auth |
|---|---|---|---|
| GET | `/api/health` | Healthcheck | Não |
| POST | `/api/auth/login` | Login (RF-20) | Não |
| GET | `/api/auth/me` | Dados do usuário logado | Sim |
| POST | `/api/auth/forgot-password` | Gera token de redefinição e envia por e-mail (SMTP) | Não |
| POST | `/api/auth/reset-password` | Troca a senha a partir do token | Não |
| GET | `/api/opportunities?search=&status=&targetAudience=` | Lista com busca e filtros (RF-03) | Sim |
| GET | `/api/opportunities/:id` | Detalhe | Sim |
| POST | `/api/opportunities` | Cria (rascunho ou publicada) (RF-01) | Sim |
| PUT | `/api/opportunities/:id` | Edita/encerra (RF-02) | Sim |
| PATCH | `/api/opportunities/:id/dispatch` | Aciona o broadcast (RF-04, RF-05) — só Administrador | Sim |
| GET | `/api/opportunities/:id/dispatch-logs` | Log de envio por destinatário (RF-06) | Sim |
| POST | `/api/webhooks/n8n/dispatch-status` | Callback do N8N com o status de entrega (RF-06) | Segredo compartilhado (`X-Webhook-Secret`) |

`status` retornado por oportunidade: `Rascunho`, `Ativa` ou `Encerrada`,
calculado automaticamente a partir de `deadline` (RF-03).

### Fluxo do disparo (RF-04 a RF-06)

1. `PATCH /:id/dispatch` valida que existe ao menos um contato com opt-in
   ativo, cria um `dispatch_logs` (`pendente`) por contato e chama o webhook
   configurado em `N8N_WEBHOOK_URL` com a mensagem já pronta (RF-05, sem
   edição manual) e a lista de contatos/`logId`.
2. O workflow do N8N entrega a mensagem via WAHA e reporta o resultado,
   contato a contato, em `POST /api/webhooks/n8n/dispatch-status`
   (`{ logId, status: "enviado" | "falha", detail }`), autenticado por
   `N8N_WEBHOOK_SECRET` (RNF-08 — nunca por JWT de usuário).
3. Se o N8N estiver inacessível no momento do disparo, os logs já nascem
   marcados como `falha` com o motivo, em vez de ficarem pendentes para
   sempre (mitigação do risco R-02).

Cadastro de contatos: RF-10 (opt-in pelo próprio WhatsApp) só chega no
Módulo D, na Sprint 04. Até lá, `npm run seed` povoa dois contatos de teste
para o broadcast poder ser exercitado localmente.

## Como testar (critérios de aceite, seção 9 do Documento de Escopo)

Casos de sucesso e de erro exercitados manualmente / via curl:

```bash
# login com credenciais inválidas → 401
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"x@x.com","password":"errada"}'

# login válido
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"coordenacao@escola.edu.br","password":"EduBot@2026"}'

# acesso sem token → 401
curl -s http://localhost:4000/api/opportunities

# cadastro com campo obrigatório ausente → 400
curl -s -X POST http://localhost:4000/api/opportunities \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"title":"Teste"}'

# disparo → cria os dispatch_logs e aciona o N8N
curl -s -X PATCH http://localhost:4000/api/opportunities/1/dispatch \
  -H "Authorization: Bearer <TOKEN>"

# consulta do log de envio
curl -s http://localhost:4000/api/opportunities/1/dispatch-logs \
  -H "Authorization: Bearer <TOKEN>"

# callback do N8N sem o segredo correto → 401
curl -s -X POST http://localhost:4000/api/webhooks/n8n/dispatch-status \
  -H "Content-Type: application/json" \
  -d '{"logId":1,"status":"enviado"}'

# callback do N8N válido
curl -s -X POST http://localhost:4000/api/webhooks/n8n/dispatch-status \
  -H "Content-Type: application/json" -H "X-Webhook-Secret: <N8N_WEBHOOK_SECRET>" \
  -d '{"logId":1,"status":"enviado","detail":"Entregue via WAHA"}'
```

## Estrutura

```
src/
  app.js                       # Express app (rotas, middlewares globais)
  server.js                    # bootstrap
  db/
    pool.js                    # pool de conexão pg
    migrate.js                 # aplica migrations/*.sql
    seed.js                    # cria contas (RF-20), equipe (Sobre Nós) e contatos de teste (RF-04)
    migrations/
      001_init.sql             # users, opportunities, logs
      005_broadcast.sql        # contacts, dispatch_logs (RF-04 a RF-06)
  middleware/
    auth.js                    # requireAuth / requireRole (RF-20, RF-21)
    webhookAuth.js              # requireWebhookSecret (RNF-08)
    errorHandler.js
  controllers/
    auth.controller.js
    opportunities.controller.js  # inclui dispatch (RF-04/05) e listDispatchLogs (RF-06)
    webhooks.controller.js       # callback de status do N8N
  routes/
    auth.routes.js
    opportunities.routes.js
    webhooks.routes.js
  utils/
    jwt.js
    classifyStatus.js          # RF-03
    n8n.js                      # dispara o webhook do N8N e monta a mensagem (RF-04, RF-05)
```
