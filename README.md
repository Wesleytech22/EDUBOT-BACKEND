# EduBot — Backend (branch: multi-escola completo)

API completa do EduBot — gestão de oportunidades, extensão mobile
(broadcast, chatbot FAQ, consentimento), métricas/auditoria, integração
com Google Sheets, sincronização periódica e dashboard escolar — agora
com **isolamento total entre escolas**: várias escolas podem usar a
mesma instalação, cada uma com seu próprio login de coordenação, suas
próprias oportunidades, contatos, disparos, métricas, planilha e alunos,
sem que uma enxergue ou afete a outra em nenhum ponto do sistema.
Node.js + Express + PostgreSQL.

Escopo acumulado — todos os módulos da EAP (seção 5.1 do Documento de
Escopo): A a I (RF-01 a RF-21), mais o isolamento por escola que estende
todos eles.

## Multi-escola: como funciona

- **`super_admin`** é o único papel sem escola (`school_id = NULL`).
  Cadastra escolas e a primeira conta de Administrador de cada uma
  (`POST /api/schools`) — mantém o espírito do RF-20 (sem autocadastro
  público), só adiciona um nível acima da coordenação. Não acessa
  nenhuma rota operacional (`/opportunities`, `/students`, etc. — 403).
- **`administrador`** e **`equipe_escola`** sempre pertencem a exatamente
  uma escola (`school_id` obrigatório, carregado no JWT). Não acessam
  `/api/schools` (403).
- **Entidades com `school_id` próprio** (isoladas diretamente):
  `users`, `opportunities`, `contacts`, `students`, `sync_runs`,
  `sheet_config` (que virou uma linha por escola, em vez de uma linha
  única global).
- **Entidades isoladas por herança** (sem coluna própria, via `JOIN` com
  a tabela que já tem `school_id`): `dispatch_logs` e `logs` (via
  `opportunities`), `chat_interactions`, `consent_logs` e
  `support_requests` (via `contacts`).
- **Webhook do WhatsApp**: cada escola tem seu próprio número/instância
  WAHA, então o workflow de N8N de cada uma chama
  `POST /webhooks/whatsapp/inbound/:schoolSlug` — a rota resolve a
  escola pelo slug (404 se não existir) antes de tocar em qualquer dado.
  O mesmo número de telefone pode ser contato em mais de uma escola
  (registros independentes) — útil para uma família com filhos em
  escolas diferentes.
- **`sheet_config`**: deixou de ser uma linha única (`id = 1`) e passa a
  ter uma linha por escola (`school_id` como chave primária) — cada
  escola configura (e sincroniza) sua própria planilha, no modo link ou
  arquivo, independentemente das outras.
- Instalações existentes (antes desta mudança) não quebram: a migration
  cria uma "Escola Padrão" e migra todos os dados antigos para ela.

Validado de ponta a ponta numa base de teste isolada: duas escolas, dois
administradores, mesmo número de telefone como contato em ambas — cada
uma só vê e mexe nos próprios dados em **todos** os módulos (oportunidade,
disparo, chatbot/menu, métricas, log de disparo, configuração de
planilha, alunos e sincronização). Testado inclusive contra acesso
direto por ID de recurso de outra escola (404, sem revelar que existe) e
contra slug de escola inexistente no webhook (404).

## Pré-requisitos

- Node.js 18+
- PostgreSQL 16, N8N e WAHA — suba os três com `infra/docker-compose.yml`
  (ver `infra/README.md`) ou aponte `.env` para uma instância própria

## Como rodar

```bash
cp .env.example .env        # ajuste as credenciais se necessário
npm install
npm run migrate             # cria schools e todas as tabelas, já isoladas por escola
npm run seed                # cria o super_admin e as contas/dados de teste da Escola Padrão
npm run dev                 # inicia em http://localhost:4000
```

Contas criadas pelo seed (definidas em `.env`):

| Perfil | E-mail | Senha | Escola |
|---|---|---|---|
| Super Admin | `superadmin@edubot.dev` | `EduBot@2026` | nenhuma (gerencia todas) |
| Administrador | `coordenacao@escola.edu.br` | `EduBot@2026` | Escola Padrão |
| Equipe da Escola | `equipe@escola.edu.br` | `EduBot@2026` | Escola Padrão |

## Endpoints

| Método | Rota | Descrição | Auth |
|---|---|---|---|
| GET | `/api/health` | Healthcheck | Não |
| POST | `/api/auth/login` | Login (RF-20) — resposta inclui `schoolId` | Não |
| GET | `/api/auth/me` | Dados do usuário logado | Sim |
| GET | `/api/schools` | Lista escolas e quantidade de contas de cada uma | Sim (super_admin) |
| POST | `/api/schools` | Cria uma escola + primeira conta de Administrador | Sim (super_admin) |
| GET | `/api/opportunities?search=&status=&targetAudience=` | Lista da própria escola (RF-03) | Sim |
| GET | `/api/opportunities/:id` | Detalhe — 404 se for de outra escola | Sim |
| POST | `/api/opportunities` | Cria na escola do usuário logado (RF-01) | Sim |
| PUT | `/api/opportunities/:id` | Edita/encerra — só da própria escola (RF-02) | Sim |
| PATCH | `/api/opportunities/:id/dispatch` | Aciona o broadcast, só para contatos da própria escola (RF-04, RF-05) | Sim |
| GET | `/api/opportunities/:id/dispatch-logs` | Log de envio — 404 se a oportunidade for de outra escola (RF-06) | Sim |
| POST | `/api/webhooks/n8n/dispatch-status` | Callback do N8N com o status de entrega (RF-06) | Segredo compartilhado |
| POST | `/api/webhooks/whatsapp/inbound/:schoolSlug` | Mensagem recebida no WhatsApp da escola `schoolSlug` (RF-07 a RF-11) | Segredo compartilhado |
| GET | `/api/support-requests` | Fila de atendimento humano da própria escola (RF-09) | Sim |
| GET | `/api/metrics/overview` | Métricas de envio/interação da própria escola (RF-12, RF-13) | Sim |
| GET | `/api/metrics/dispatch-logs` | Log de envio de todas as oportunidades da própria escola (RF-12) | Sim |
| GET | `/api/integrations/sheets/config` | Planilha configurada — link ou arquivo, da própria escola (RF-15) | Sim |
| PUT | `/api/integrations/sheets/config` | Configura o link/intervalo da própria escola (RF-15) | Sim (Administrador) |
| POST | `/api/integrations/sheets/upload` | Anexa um CSV da própria escola (RF-15) | Sim (Administrador) |
| GET | `/api/integrations/sheets/preview` | Lê a planilha configurada da própria escola (RF-14) | Sim |
| GET | `/api/students?search=&grade=&situation=&schoolYear=` | Dashboard escolar da própria escola (RF-18) | Sim |
| GET | `/api/students/summary` | Indicadores agregados da própria escola (RF-19) | Sim |
| GET | `/api/students/sync-status` | Status de sincronização da própria escola (RF-17) | Sim |
| POST | `/api/students/sync` | Sincroniza agora a planilha da própria escola (RF-16) | Sim (Administrador) |

`status` retornado por oportunidade: `Rascunho`, `Ativa` ou `Encerrada`,
calculado automaticamente a partir de `deadline` (RF-03).

### Fluxo do disparo (RF-04 a RF-06)

1. `PATCH /:id/dispatch` valida que existe ao menos um contato **da mesma
   escola** com opt-in ativo, cria um `dispatch_logs` (`pendente`) por
   contato e chama o webhook configurado em `N8N_WEBHOOK_URL` com a
   mensagem já pronta (RF-05, sem edição manual) e a lista de
   contatos/`logId`.
2. O workflow do N8N entrega a mensagem via WAHA e reporta o resultado,
   contato a contato, em `POST /api/webhooks/n8n/dispatch-status`
   (`{ logId, status: "enviado" | "falha", detail }`), autenticado por
   `N8N_WEBHOOK_SECRET` (RNF-08 — nunca por JWT de usuário).
3. Se o N8N estiver inacessível no momento do disparo, os logs já nascem
   marcados como `falha` com o motivo, em vez de ficarem pendentes para
   sempre (mitigação do risco R-02).

### Fluxo conversacional (RF-07 a RF-11)

`POST /api/webhooks/whatsapp/inbound/:schoolSlug` recebe
`{ phone, name, message }` — uma mensagem relayada pelo N8N a partir do
WAHA **daquela escola** — e devolve `{ reply }` com o texto que o
workflow deve reenviar ao contato. `schoolSlug` inexistente responde 404
antes de qualquer outra coisa acontecer.

- **Opt-in/opt-out (RF-10, RF-11)**: comandos `ENTRAR`/`INICIAR`/`START` e
  `SAIR`/`PARAR`/`STOP` atualizam `contacts.opt_in` na hora e gravam um
  registro em `consent_logs` (tipo, origem e data/hora).
- **Menu (RF-08)**: comando `MENU` lista as oportunidades ativas — só as
  da escola do webhook.
- **FAQ (RF-07)**: qualquer outra mensagem é casada por substring contra o
  título das oportunidades ativas **da mesma escola** — casamento simples
  por palavra-chave, sem NLP/classificação de intenção, adequado ao
  escopo do MVP e ao RNF-01 (resposta em menos de 5s).
- **Atendimento humano (RF-09)**: comando `ATENDENTE`, ou qualquer mensagem
  que o casamento por título não resolveu, cria um registro em
  `support_requests` (consultável por `GET /api/support-requests`, já
  filtrado pela escola de quem consulta).

Um contato que ainda não deu opt-in só recebe a instrução de enviar
`ENTRAR` — nenhuma outra funcionalidade do bot roda antes disso (RNF-03).

### Métricas (RF-12, RF-13)

`GET /api/metrics/overview` calcula tudo a partir de dados reais já
gravados **da própria escola** (nada de números fixos, nenhuma mistura
com outra escola):

- **Envio** (`dispatch`): total de notificações, entregues, falhas,
  pendentes, contatos alcançados e taxa de entrega — de `dispatch_logs`
  filtrado via `JOIN opportunities` pela escola do usuário.
- **Interação** (`chatbot`): total de interações, resolvidas pelo FAQ,
  encaminhadas a humano, taxa de automação, taxa de resposta, as 5
  dúvidas mais frequentes e o ranking de oportunidades por engajamento —
  de `chat_interactions` filtrado via `JOIN contacts` pela escola.

Enquanto nenhum disparo ou interação acontecer, os números vêm zerados —
não há dado fictício aqui, diferente do dashboard do frontend na Sprint 02.

### Integração com Google Sheets (RF-14, RF-15)

Dois modos, alternáveis a qualquer momento, configurados **por escola**
(`sheet_config` tem uma linha por `school_id`):

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
sincronização funciona igual esteja a escola no modo "link" ou "arquivo".
Layout esperado das linhas (a partir do intervalo configurado, no modo
link, ou das colunas do CSV, no modo arquivo — sem cabeçalho):

| Coluna A | Coluna B | Coluna C | Coluna D | Coluna E |
|---|---|---|---|---|
| Nome | Série | Presenças | Faltas | Situação (`Regular`/`Atenção`/`Risco`) |

A coordenação registra **presenças e faltas** (números inteiros) — nunca
uma porcentagem digitada à mão. `attendance` (frequência, em %) é sempre
calculada pelo sistema a partir desses dois números
(`presenças ÷ (presenças + faltas) × 100`, arredondado a 1 casa decimal);
`GET /api/students` devolve `attendancePresent` e `attendanceAbsent` além
do percentual já calculado.

- **RF-16**: além de `POST /api/students/sync` (dispara a sincronização
  só da escola de quem chama), o `server.js` roda `syncAllSchools()` a
  cada `SYNC_INTERVAL_MINUTES` minutos (padrão 15; `0` desativa) —
  percorre toda escola que já tem uma planilha configurada (uma escola
  que nunca configurou nada não acumula tentativas "fantasma"). No modo
  "arquivo", cada execução simplesmente reprocessa o último CSV enviado
  — só muda de fato quando alguém anexa um arquivo novo.
- **RF-17**: cada tentativa (sucesso ou falha) grava uma linha em
  `sync_runs`, já com o `school_id` de quem sincronizou;
  `GET /api/students/sync-status` devolve a data/hora da última
  sincronização **bem-sucedida** e o resultado da última tentativa da
  própria escola, seja qual for.
- **RF-18**: `students` é upsertada por `(school_id, nome, série, ano
  letivo)` — sem um ID estável vindo da planilha, o nome é a chave
  natural dentro de cada escola; duas escolas podem ter um aluno de
  mesmo nome sem conflito.
- **RF-19**: `GET /api/students/summary` calcula frequência média e um
  "desempenho geral" definido como o percentual de alunos em situação
  `Regular`, só da própria escola — um indicador simples e verificável,
  sem inventar uma nota composta que a planilha não fornece.

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

# login válido (repare no schoolId na resposta)
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"coordenacao@escola.edu.br","password":"EduBot@2026"}'

# acesso sem token → 401
curl -s http://localhost:4000/api/opportunities

# cadastro com campo obrigatório ausente → 400
curl -s -X POST http://localhost:4000/api/opportunities \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"title":"Teste"}'

# super_admin cria uma segunda escola
curl -s -X POST http://localhost:4000/api/schools \
  -H "Authorization: Bearer <TOKEN_SUPER_ADMIN>" -H "Content-Type: application/json" \
  -d '{"name":"Escola B","slug":"escola-b","adminName":"Coordenação B","adminEmail":"coord.b@escolab.edu.br","adminPassword":"SenhaForte@2026"}'

# administrador não acessa /api/schools → 403 / super_admin não acessa /api/opportunities → 403
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4000/api/schools -H "Authorization: Bearer <TOKEN_ADMIN>"
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4000/api/opportunities -H "Authorization: Bearer <TOKEN_SUPER_ADMIN>"

# isolamento: uma escola não acessa oportunidade/log de outra por ID direto → 404
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4000/api/opportunities/1 -H "Authorization: Bearer <TOKEN_OUTRA_ESCOLA>"

# webhook com slug de escola inexistente → 404
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST http://localhost:4000/api/webhooks/whatsapp/inbound/escola-fantasma \
  -H "Content-Type: application/json" -H "X-Webhook-Secret: <N8N_WEBHOOK_SECRET>" \
  -d '{"phone":"+5511999990099","message":"ENTRAR"}'

# opt-in numa escola específica
curl -s -X POST http://localhost:4000/api/webhooks/whatsapp/inbound/escola-padrao \
  -H "Content-Type: application/json" -H "X-Webhook-Secret: <N8N_WEBHOOK_SECRET>" \
  -d '{"phone":"+5511999990099","message":"ENTRAR"}'

# menu — só as oportunidades ativas daquela escola
curl -s -X POST http://localhost:4000/api/webhooks/whatsapp/inbound/escola-padrao \
  -H "Content-Type: application/json" -H "X-Webhook-Secret: <N8N_WEBHOOK_SECRET>" \
  -d '{"phone":"+5511999990099","message":"MENU"}'

# disparo → cria os dispatch_logs só dos contatos da própria escola e aciona o N8N
curl -s -X PATCH http://localhost:4000/api/opportunities/1/dispatch -H "Authorization: Bearer <TOKEN>"

# métricas consolidadas da própria escola (RF-12, RF-13)
curl -s http://localhost:4000/api/metrics/overview -H "Authorization: Bearer <TOKEN>"

# configura a planilha por link, da própria escola (RF-15, modo "link")
curl -s -X PUT http://localhost:4000/api/integrations/sheets/config \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"sheetUrl":"https://docs.google.com/spreadsheets/d/<ID_DA_PLANILHA>/edit","sheetRange":"Alunos!A2:E"}'

# anexa um CSV em vez do link (RF-15, modo "arquivo")
curl -s -X POST http://localhost:4000/api/integrations/sheets/upload \
  -H "Authorization: Bearer <TOKEN>" -F "file=@alunos.csv"

# dashboard escolar da própria escola (RF-18)
curl -s "http://localhost:4000/api/students?situation=Risco" -H "Authorization: Bearer <TOKEN>"

# dispara a sincronização agora, só da própria escola (RF-16)
curl -s -X POST http://localhost:4000/api/students/sync -H "Authorization: Bearer <TOKEN>"
```

## Estrutura

```
src/
  app.js                     # Express app (rotas, middlewares globais)
  server.js                  # bootstrap; syncAllSchools() percorre toda escola configurada (RF-16)
  db/
    pool.js                  # pool de conexão pg
    migrate.js               # aplica migrations/*.sql
    seed.js                  # cria super_admin, contas/contatos/alunos de teste da Escola Padrão
    migrations/
      001_init.sql                       # users, opportunities, logs
      002_broadcast.sql                  # contacts, dispatch_logs (RF-04 a RF-06)
      003_chatbot_consentimento.sql      # consent_logs, support_requests (RF-07 a RF-11)
      004_metricas_integracoes.sql       # chat_interactions, sheet_config (RF-12 a RF-15)
      005_dashboard_escolar.sql          # students, sync_runs (RF-16 a RF-19)
      006_sheet_upload.sql               # colunas de source/upload em sheet_config (RF-15)
      007_frequencia_presencas_faltas.sql # presenças/faltas em students (RF-18)
      008_multi_escola.sql               # schools, school_id em users/opportunities, papel super_admin
      009_multi_escola_extensao.sql      # school_id em contacts/students/sync_runs/sheet_config
  middleware/
    auth.js                  # requireAuth / requireRole (RF-20, RF-21)
    webhookAuth.js            # requireWebhookSecret (RNF-08)
    errorHandler.js
  controllers/
    auth.controller.js
    opportunities.controller.js  # toda query filtrada por school_id; dispatch/logs também
    schools.controller.js        # criação/listagem de escolas (super_admin)
    webhooks.controller.js       # callback de status do N8N
    whatsapp.controller.js       # resolve a escola por :schoolSlug antes de tudo (RF-07 a RF-11)
    metrics.controller.js        # métricas via JOIN opportunities/contacts pela escola (RF-12, RF-13)
    integrations.controller.js   # sheet_config por escola — link/arquivo (RF-14, RF-15)
    students.controller.js       # dashboard escolar, resumo e sync, por escola (RF-16 a RF-19)
  routes/
    auth.routes.js
    opportunities.routes.js
    schools.routes.js
    webhooks.routes.js            # inclui /whatsapp/inbound/:schoolSlug
    support.routes.js
    metrics.routes.js
    integrations.routes.js        # inclui o upload multipart (multer, em memória)
    students.routes.js
  utils/
    jwt.js                    # token carrega schoolId
    classifyStatus.js         # RF-03
    n8n.js                    # dispara o webhook do N8N e monta a mensagem (RF-04, RF-05)
    googleSheets.js           # extrai o ID do link, lê via API key e unifica com o modo arquivo (RF-14, RF-15)
    csvParser.js              # parseia o CSV anexado (RF-15)
    studentsSync.js           # syncStudentsFromSheet(schoolId) e syncAllSchools() (RF-16, RF-17)
```
