# EduBot — Backend (Sprint 06)

API completa do EduBot: gestão de oportunidades, extensão mobile
(broadcast, chatbot FAQ, consentimento), métricas/auditoria, integração
com Google Sheets e, a partir desta Sprint, sincronização periódica e
dashboard escolar. Node.js + Express + PostgreSQL.

Escopo acumulado — todos os módulos da EAP (seção 5.1 do Documento de
Escopo): A (RF-01 a RF-03), B (RF-04 a RF-06), C (RF-07 a RF-09), D
(RF-10, RF-11), E (RF-12, RF-13), F (RF-14, RF-15), I (RF-20, RF-21) e,
a partir desta Sprint, G — Sincronização de Dados (RF-16, RF-17) e
H — Dashboard Escolar (RF-18, RF-19). Esta é a última Sprint do
Documento de Escopo (seção 7.7).

## Pré-requisitos

- Node.js 18+
- PostgreSQL 16, N8N e WAHA — suba os três com `infra/docker-compose.yml`
  (ver `infra/README.md`) ou aponte `.env` para uma instância própria

## Como rodar

```bash
cp .env.example .env        # ajuste as credenciais se necessário
npm install
npm run migrate             # cria as tabelas (users, opportunities, logs, contacts, dispatch_logs, consent_logs, support_requests, chat_interactions, sheet_config, students, sync_runs)
npm run seed                # cria as contas de acesso, contatos e alunos de teste
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
| GET | `/api/opportunities?search=&status=&targetAudience=` | Lista com busca e filtros (RF-03) | Sim |
| GET | `/api/opportunities/:id` | Detalhe | Sim |
| POST | `/api/opportunities` | Cria (rascunho ou publicada) (RF-01) | Sim |
| PUT | `/api/opportunities/:id` | Edita/encerra (RF-02) | Sim |
| PATCH | `/api/opportunities/:id/dispatch` | Aciona o broadcast (RF-04, RF-05) | Sim |
| GET | `/api/opportunities/:id/dispatch-logs` | Log de envio por destinatário (RF-06) | Sim |
| POST | `/api/webhooks/n8n/dispatch-status` | Callback do N8N com o status de entrega (RF-06) | Segredo compartilhado (`X-Webhook-Secret`) |
| POST | `/api/webhooks/whatsapp/inbound` | Mensagem recebida no WhatsApp (RF-07 a RF-11) | Segredo compartilhado (`X-Webhook-Secret`) |
| GET | `/api/support-requests` | Fila de solicitações encaminhadas a atendente humano (RF-09) | Sim |
| GET | `/api/metrics/overview` | Métricas de envio e de interação consolidadas (RF-12, RF-13) | Sim |
| GET | `/api/metrics/dispatch-logs` | Log de envio de todas as oportunidades, mais recentes primeiro (RF-12) | Sim |
| GET | `/api/integrations/sheets/config` | Planilha configurada — link ou arquivo (RF-15) | Sim |
| PUT | `/api/integrations/sheets/config` | Configura o link/intervalo — modo "link" (RF-15) | Sim (Administrador) |
| POST | `/api/integrations/sheets/upload` | Anexa um CSV — modo "arquivo" (RF-15) | Sim (Administrador) |
| GET | `/api/integrations/sheets/preview` | Prova de conceito: lê a planilha configurada, nos dois modos (RF-14) | Sim |
| GET | `/api/students?search=&grade=&situation=&schoolYear=` | Dashboard escolar consolidado, com busca e filtros (RF-18) | Sim |
| GET | `/api/students/summary` | Indicadores agregados da turma (RF-19) | Sim |
| GET | `/api/students/sync-status` | Data/hora da última sincronização e último resultado (RF-17) | Sim |
| POST | `/api/students/sync` | Dispara a sincronização imediatamente (RF-16) | Sim (Administrador) |

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

### Fluxo conversacional (RF-07 a RF-11)

`POST /api/webhooks/whatsapp/inbound` recebe `{ phone, name, message }` —
uma mensagem relayada pelo N8N a partir do WAHA — e devolve `{ reply }`
com o texto que o workflow deve reenviar ao contato:

- **Opt-in/opt-out (RF-10, RF-11)**: comandos `ENTRAR`/`INICIAR`/`START` e
  `SAIR`/`PARAR`/`STOP` atualizam `contacts.opt_in` na hora e gravam um
  registro em `consent_logs` (tipo, origem e data/hora).
- **Menu (RF-08)**: comando `MENU` lista as oportunidades ativas.
- **FAQ (RF-07)**: qualquer outra mensagem é casada por substring contra o
  título das oportunidades ativas — casamento simples por palavra-chave,
  sem NLP/classificação de intenção, adequado ao escopo do MVP e ao RNF-01
  (resposta em menos de 5s).
- **Atendimento humano (RF-09)**: comando `ATENDENTE`, ou qualquer mensagem
  que o casamento por título não resolveu, cria um registro em
  `support_requests` (consultável por `GET /api/support-requests`).

Um contato que ainda não deu opt-in só recebe a instrução de enviar
`ENTRAR` — nenhuma outra funcionalidade do bot roda antes disso (RNF-03).

### Métricas (RF-12, RF-13)

`GET /api/metrics/overview` calcula tudo a partir de dados reais já
gravados (nada de números fixos):

- **Envio** (`dispatch`): total de notificações, entregues, falhas,
  pendentes, contatos alcançados e taxa de entrega — de `dispatch_logs`.
- **Interação** (`chatbot`): total de interações, resolvidas pelo FAQ,
  encaminhadas a humano, taxa de automação, taxa de resposta (contatos que
  interagiram ÷ contatos alcançados pelo broadcast), as 5 dúvidas mais
  frequentes e o ranking de oportunidades por engajamento (perguntas
  recebidas ÷ contatos que a receberam) — tudo a partir de
  `chat_interactions` (Sprint 04/05) e `dispatch_logs` (Sprint 03).

Enquanto nenhum disparo ou interação acontecer, os números vêm zerados —
não há dado fictício aqui, diferente do dashboard do frontend na Sprint 02.

### Integração com Google Sheets (RF-14, RF-15)

Dois modos, alternáveis a qualquer momento, para escolas que preferem não
compartilhar o link da planilha com o time técnico:

**Modo "link"** — prova de conceito com uma API key (sem OAuth/service
account), para uma planilha compartilhada como "qualquer pessoa com o
link pode visualizar":

1. O Administrador cola o link (ou o ID isolado, por compatibilidade) em
   `PUT /api/integrations/sheets/config` (`{ sheetUrl, sheetRange }`) — o
   ID é extraído do link automaticamente (RF-15).
2. `GET /api/integrations/sheets/preview` lê a planilha configurada via
   `GOOGLE_SHEETS_API_KEY` e devolve as linhas cruas.
3. Sem `GOOGLE_SHEETS_API_KEY` configurada, ou sem planilha configurada, o
   endpoint responde 400 com uma mensagem clara — não há tentativa de
   simular uma leitura que não aconteceu de fato.

**Modo "arquivo"** — a escola exporta a planilha (Arquivo > Fazer
download > Valores separados por vírgula) e anexa o CSV:

1. `POST /api/integrations/sheets/upload` (multipart, campo `file`,
   até 5 MB, só `.csv`) — o arquivo fica em memória, nunca é gravado em
   disco, e as linhas parseadas ficam salvas em `sheet_config.uploaded_rows`.
   **A primeira linha do arquivo é sempre tratada como cabeçalho e
   descartada** — como toda planilha exportada já vem por padrão.
2. A partir daí, `GET /api/integrations/sheets/preview` devolve o conteúdo
   do arquivo anexado, sem chamar a API do Google.
3. Enviar um novo arquivo substitui o anterior; alternar de volta para o
   modo "link" é só configurar `sheetUrl` de novo.

Optamos por CSV em vez de `.xlsx` porque a biblioteca mais usada para ler
Excel no Node (`xlsx`/SheetJS) tem vulnerabilidades conhecidas de alta
severidade sem correção publicada no npm — um risco real num endpoint que
recebe arquivo de upload não confiável. CSV é uma exportação de um clique
tanto no Google Sheets quanto no Excel.

### Sincronização e dashboard escolar (RF-16 a RF-19)

`resolveSheetRows()` unifica os dois modos de configuração acima — a
sincronização abaixo funciona igual esteja a escola no modo "link" ou
"arquivo". Layout esperado das linhas (a partir do intervalo configurado,
no modo link, ou das colunas do CSV, no modo arquivo — sem cabeçalho):

| Coluna A | Coluna B | Coluna C | Coluna D | Coluna E |
|---|---|---|---|---|
| Nome | Série | Presenças | Faltas | Situação (`Regular`/`Atenção`/`Risco`) |

A coordenação registra **presenças e faltas** (números inteiros) — nunca
uma porcentagem digitada à mão. `attendance` (frequência, em %) é sempre
calculada pelo sistema a partir desses dois números
(`presenças ÷ (presenças + faltas) × 100`, arredondado a 1 casa decimal);
`GET /api/students` devolve `attendancePresent` e `attendanceAbsent` além
do percentual já calculado.

- **RF-16**: além de `POST /api/students/sync` (disparo manual), o
  `server.js` roda `syncStudentsFromSheet()` a cada `SYNC_INTERVAL_MINUTES`
  minutos (padrão 15; `0` desativa) — a mesma rotina dos dois casos, então
  o comportamento é idêntico esperando o intervalo ou forçando agora. No
  modo "arquivo", cada execução simplesmente reprocessa o último CSV
  enviado — só muda de fato quando alguém anexa um arquivo novo.
- **RF-17**: cada tentativa (sucesso ou falha) grava uma linha em
  `sync_runs`; `GET /api/students/sync-status` devolve a data/hora da
  última sincronização **bem-sucedida** e o resultado da última tentativa,
  seja qual for.
- **RF-18**: `students` é upsertada por `(nome, série, ano letivo)` — sem
  um ID estável vindo da planilha, o nome é a chave natural; uma limitação
  aceitável para o escopo do MVP com uma única escola parceira.
- **RF-19**: `GET /api/students/summary` calcula frequência média e um
  "desempenho geral" definido como o percentual de alunos em situação
  `Regular` — um indicador simples e verificável, sem inventar uma nota
  composta que a planilha da escola não fornece.

A arquitetura é somente leitura em relação à planilha (seção 5.7): o
EduBot lê e apresenta, nunca escreve de volta no Google Sheets (nem no
CSV anexado).

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

# contato novo pergunta algo antes do opt-in → recebe só a instrução de opt-in
curl -s -X POST http://localhost:4000/api/webhooks/whatsapp/inbound \
  -H "Content-Type: application/json" -H "X-Webhook-Secret: <N8N_WEBHOOK_SECRET>" \
  -d '{"phone":"+5511999990099","name":"Teste","message":"oi"}'

# opt-in
curl -s -X POST http://localhost:4000/api/webhooks/whatsapp/inbound \
  -H "Content-Type: application/json" -H "X-Webhook-Secret: <N8N_WEBHOOK_SECRET>" \
  -d '{"phone":"+5511999990099","message":"ENTRAR"}'

# menu de oportunidades ativas
curl -s -X POST http://localhost:4000/api/webhooks/whatsapp/inbound \
  -H "Content-Type: application/json" -H "X-Webhook-Secret: <N8N_WEBHOOK_SECRET>" \
  -d '{"phone":"+5511999990099","message":"MENU"}'

# fila de atendimento humano
curl -s http://localhost:4000/api/support-requests -H "Authorization: Bearer <TOKEN>"

# métricas consolidadas (RF-12, RF-13)
curl -s http://localhost:4000/api/metrics/overview -H "Authorization: Bearer <TOKEN>"

# configura a planilha por link (RF-15, modo "link")
curl -s -X PUT http://localhost:4000/api/integrations/sheets/config \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"sheetUrl":"https://docs.google.com/spreadsheets/d/<ID_DA_PLANILHA>/edit","sheetRange":"Alunos!A2:E"}'

# anexa um CSV em vez do link (RF-15, modo "arquivo")
curl -s -X POST http://localhost:4000/api/integrations/sheets/upload \
  -H "Authorization: Bearer <TOKEN>" -F "file=@alunos.csv"

# prévia da leitura da planilha (RF-14) — 400 se nada estiver configurado
curl -s http://localhost:4000/api/integrations/sheets/preview -H "Authorization: Bearer <TOKEN>"

# dashboard escolar (RF-18) — dados de seed, sem depender de planilha real
curl -s "http://localhost:4000/api/students?situation=Risco" -H "Authorization: Bearer <TOKEN>"

# indicadores agregados (RF-19)
curl -s http://localhost:4000/api/students/summary -H "Authorization: Bearer <TOKEN>"

# status da sincronização (RF-17)
curl -s http://localhost:4000/api/students/sync-status -H "Authorization: Bearer <TOKEN>"

# dispara a sincronização agora (RF-16) — falha de forma controlada sem planilha configurada
curl -s -X POST http://localhost:4000/api/students/sync -H "Authorization: Bearer <TOKEN>"
```

## Estrutura

```
src/
  app.js                     # Express app (rotas, middlewares globais)
  server.js                  # bootstrap
  db/
    pool.js                  # pool de conexão pg
    migrate.js               # aplica migrations/*.sql
    seed.js                  # cria contas (RF-20), contatos (RF-04) e alunos (RF-18) de teste
    migrations/
      001_init.sql           # users, opportunities, logs
      002_broadcast.sql      # contacts, dispatch_logs (RF-04 a RF-06)
      003_chatbot_consentimento.sql  # consent_logs, support_requests (RF-07 a RF-11)
      004_metricas_integracoes.sql   # chat_interactions, sheet_config (RF-12 a RF-15)
      005_dashboard_escolar.sql      # students, sync_runs (RF-16 a RF-19)
      007_frequencia_presencas_faltas.sql  # presencas/faltas em students (RF-18)
      006_sheet_upload.sql           # colunas de source/upload em sheet_config (RF-15)
  middleware/
    auth.js                  # requireAuth / requireRole (RF-20, RF-21)
    webhookAuth.js            # requireWebhookSecret (RNF-08)
    errorHandler.js
  controllers/
    auth.controller.js
    opportunities.controller.js  # inclui dispatch (RF-04/05) e listDispatchLogs (RF-06)
    webhooks.controller.js       # callback de status do N8N
    whatsapp.controller.js       # fluxo conversacional (RF-07 a RF-11) + log de interações (RF-13)
    metrics.controller.js        # métricas de envio e interação (RF-12, RF-13)
    integrations.controller.js   # configuração (link/arquivo) e leitura do Google Sheets (RF-14, RF-15)
    students.controller.js       # dashboard escolar, resumo e status de sync (RF-16 a RF-19)
  routes/
    auth.routes.js
    opportunities.routes.js
    webhooks.routes.js
    support.routes.js            # fila de atendimento humano (RF-09)
    metrics.routes.js
    integrations.routes.js       # inclui o upload multipart (multer, em memória)
    students.routes.js
  utils/
    jwt.js
    classifyStatus.js        # RF-03
    n8n.js                   # dispara o webhook do N8N e monta a mensagem (RF-04, RF-05)
    googleSheets.js          # extrai o ID do link, lê via API key e unifica com o modo arquivo (RF-14, RF-15)
    csvParser.js             # parseia o CSV anexado (RF-15)
    studentsSync.js          # lê a planilha (nos dois modos) e faz upsert em students (RF-16, RF-17)
```
