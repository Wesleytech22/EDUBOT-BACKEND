-- EduBot — Sprint 04 — Módulo C (Chatbot FAQ) e Módulo D (Gestão de
-- Consentimento): RF-07 a RF-11.

-- RF-11 — registro de data, hora e origem de cada consentimento e
-- cancelamento (não só o estado atual em contacts.opt_in).
CREATE TABLE IF NOT EXISTS consent_logs (
  id          SERIAL PRIMARY KEY,
  contact_id  INTEGER NOT NULL REFERENCES contacts(id),
  type        VARCHAR(10) NOT NULL CHECK (type IN ('opt_in', 'opt_out')),
  origin      VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RF-09 — encaminhamento a atendente humano quando o fluxo automático não
-- resolve, com registro da solicitação.
CREATE TABLE IF NOT EXISTS support_requests (
  id          SERIAL PRIMARY KEY,
  contact_id  INTEGER NOT NULL REFERENCES contacts(id),
  message     TEXT NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'pendente'
                CHECK (status IN ('pendente', 'atendido')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_logs_contact ON consent_logs(contact_id);
CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests(status);
