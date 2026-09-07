# EduBot — Backend (Sprint 02)

API do Módulo Web de Gestão de Oportunidades. Node.js + Express + PostgreSQL.

Escopo: Módulo A (RF-01 a RF-03) e Módulo I (RF-20, RF-21). Nada além disso —
o disparo (`PATCH /:id/dispatch`) apenas altera o status no banco, sem chamar
N8N/WAHA (ver `documentos/E-Kanban-Sprint02.md`).

## Pré-requisitos

- Node.js 18+
- PostgreSQL 16 (pode ser o do `infra/docker-compose.yml`)

## Como rodar

```bash
cp .env.example .env        # ajuste as credenciais se necessário
npm install
npm run migrate             # cria as tabelas (users, opportunities, logs)
npm run seed                # cria as duas contas de acesso (sem sign-up público)
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
```

## Estrutura

```
src/
  app.js                 # Express app (rotas, middlewares globais)
  server.js              # bootstrap
  db/
    pool.js              # pool de conexão pg
    migrate.js           # aplica migrations/*.sql
    seed.js              # cria contas (RF-20, sem sign-up público)
    migrations/001_init.sql
  middleware/
    auth.js              # requireAuth / requireRole (RF-20, RF-21)
    errorHandler.js
  controllers/
    auth.controller.js
    opportunities.controller.js
  routes/
    auth.routes.js
    opportunities.routes.js
  utils/
    jwt.js
    classifyStatus.js    # RF-03
```
