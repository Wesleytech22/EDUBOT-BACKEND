# EduBot — Backend (branch: multi-escola)

API do Módulo Web de Gestão de Oportunidades. Node.js + Express + PostgreSQL.
Parte da Sprint 02 e adiciona a fundação multi-tenant: várias escolas,
cada uma com seu próprio login de coordenação e suas próprias
oportunidades, totalmente isoladas entre si.

Escopo desta branch: Módulo A (RF-01 a RF-03), Módulo I (RF-20, RF-21) e
o novo isolamento por escola (`schools`, `users.school_id`,
`opportunities.school_id`). O disparo (`PATCH /:id/dispatch`) continua
alterando só o status no banco, sem chamar N8N/WAHA — isso é a Sprint 03.

## Multi-escola: como funciona

- **`super_admin`** é o único papel que não pertence a nenhuma escola
  (`school_id = NULL`). Cadastra escolas e a primeira conta de
  Administrador de cada uma — mantém o espírito do RF-20 (sem
  autocadastro público), só adiciona um nível acima da coordenação.
- **`administrador`** e **`equipe_escola`** sempre pertencem a exatamente
  uma escola (`school_id` obrigatório). O token JWT carrega `schoolId`, e
  toda consulta de oportunidades filtra por ele — uma escola nunca vê,
  edita ou dispara a oportunidade de outra (testado inclusive por acesso
  direto ao ID: retorna 404, não um erro de permissão que revelaria que o
  registro existe).
- **`/api/schools`** é exclusivo do `super_admin`; **`/api/opportunities`**
  é exclusivo de `administrador`/`equipe_escola` — nenhum papel acessa a
  área do outro.
- Instalações existentes (antes desta mudança) não quebram: a migration
  cria uma "Escola Padrão" e migra os dados antigos para ela
  automaticamente.

## Pré-requisitos

- Node.js 18+
- PostgreSQL 16 (pode ser o do `infra/docker-compose.yml`)

## Como rodar

```bash
cp .env.example .env        # ajuste as credenciais se necessário
npm install
npm run migrate             # cria schools, users, opportunities, logs
npm run seed                # cria o super_admin e as contas da Escola Padrão
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
| GET | `/api/opportunities?search=&status=&targetAudience=` | Lista da **própria escola**, com busca e filtros (RF-03) | Sim (administrador/equipe_escola) |
| GET | `/api/opportunities/:id` | Detalhe — 404 se for de outra escola | Sim |
| POST | `/api/opportunities` | Cria na escola do usuário logado (RF-01) | Sim |
| PUT | `/api/opportunities/:id` | Edita/encerra — só da própria escola (RF-02) | Sim |
| PATCH | `/api/opportunities/:id/dispatch` | Marca como disparada — **só no banco** (RF-05 restrito à S02) | Sim |

`status` retornado por oportunidade: `Rascunho`, `Ativa` ou `Encerrada`,
calculado automaticamente a partir de `deadline` (RF-03).

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

# administrador não acessa /api/schools → 403
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4000/api/schools -H "Authorization: Bearer <TOKEN_ADMIN>"

# super_admin não acessa /api/opportunities → 403
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4000/api/opportunities -H "Authorization: Bearer <TOKEN_SUPER_ADMIN>"

# isolamento: uma escola não acessa oportunidade de outra por ID direto → 404
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4000/api/opportunities/1 -H "Authorization: Bearer <TOKEN_OUTRA_ESCOLA>"
```

Esse fluxo completo (duas escolas, dois administradores, isolamento
testado inclusive por acesso direto ao ID) foi validado manualmente numa
base de dados isolada antes deste commit.

## O que ainda não é multi-escola

O isolamento por `school_id` cobre `users` e `opportunities` — o
suficiente para várias escolas logarem e gerenciarem suas próprias
oportunidades, que era o pedido. As demais frentes construídas em outras
branches (broadcast/contatos, chatbot, métricas, integração com planilha,
dashboard escolar) ainda são compartilhadas entre todas as escolas;
estender o isolamento para elas fica para uma próxima branch, no mesmo
espírito em que Sprint05/06 foram construídas em cima de Sprint03/04. O
ponto que vai exigir uma decisão de arquitetura própria: o webhook do
WhatsApp (`POST /webhooks/whatsapp/inbound`) hoje não sabe de qual escola
veio a mensagem — com várias escolas (cada uma com seu próprio número/
instância WAHA), a rota vai precisar identificar isso de algum jeito
(ex.: `POST /webhooks/whatsapp/inbound/:schoolSlug`, configurado no N8N
de cada escola).

## Estrutura

```
src/
  app.js                    # Express app (rotas, middlewares globais)
  server.js                 # bootstrap
  db/
    pool.js                 # pool de conexão pg
    migrate.js              # aplica migrations/*.sql
    seed.js                 # cria o super_admin e as contas da Escola Padrão
    migrations/
      001_init.sql          # users, opportunities, logs
      002_multi_escola.sql  # schools, school_id em users/opportunities, papel super_admin
  middleware/
    auth.js                 # requireAuth / requireRole (RF-20, RF-21)
    errorHandler.js
  controllers/
    auth.controller.js
    opportunities.controller.js  # toda query filtrada por school_id
    schools.controller.js        # criação/listagem de escolas (super_admin)
  routes/
    auth.routes.js
    opportunities.routes.js
    schools.routes.js
  utils/
    jwt.js                  # token agora carrega schoolId
    classifyStatus.js       # RF-03
```
