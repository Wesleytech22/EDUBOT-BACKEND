-- EduBot — Sprint 03 — Módulo B: Notificação em Massa (RF-04 a RF-06)

-- Lista de contatos com opt-in ativo. O fluxo completo de opt-in/opt-out
-- pelo próprio WhatsApp (RF-10, RF-11) é entregue no Módulo D, na Sprint 04.
-- Aqui a tabela existe apenas como a lista de destinatários que o broadcast
-- desta Sprint consome.
CREATE TABLE IF NOT EXISTS contacts (
  id          SERIAL PRIMARY KEY,
  phone       VARCHAR(20) NOT NULL UNIQUE,
  name        VARCHAR(150),
  opt_in      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RF-06 — log de cada envio: destinatário, oportunidade, data/hora e status
-- de entrega. É criado em 'pendente' no disparo (RF-05) e atualizado pelo
-- callback do workflow do N8N/WAHA (ver POST /api/webhooks/n8n/dispatch-status).
CREATE TABLE IF NOT EXISTS dispatch_logs (
  id              SERIAL PRIMARY KEY,
  opportunity_id  INTEGER NOT NULL REFERENCES opportunities(id),
  contact_id      INTEGER NOT NULL REFERENCES contacts(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente', 'enviado', 'falha')),
  detail          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_logs_opportunity ON dispatch_logs(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_contacts_opt_in ON contacts(opt_in);
