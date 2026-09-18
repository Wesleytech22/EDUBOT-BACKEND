# Infra — Sprint 02

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

## Notas

- Os dados de cada serviço persistem em volumes nomeados (`postgres_data`,
  `n8n_data`, `waha_data`); `docker compose down -v` apaga tudo.
- As credenciais deste arquivo são apenas para o ambiente de teste local —
  nunca reutilize em produção (RNF-08).
- Depois de subir o Postgres, rode as migrations do backend normalmente
  (`npm run migrate` na raiz do repositório).
