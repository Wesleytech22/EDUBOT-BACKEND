-- EduBot — Sprint 05 — Módulo E (Métricas e Auditoria, RF-12/13) e
-- Módulo F (Integração Google Sheets, RF-14/15).

-- RF-13 — sustenta "dúvidas mais frequentes", "taxa de respostas recebidas"
-- e "oportunidades com maior engajamento": cada mensagem recebida no
-- webhook do WhatsApp (Sprint 04) passa a gerar um registro aqui, com a
-- classificação de como foi resolvida.
CREATE TABLE IF NOT EXISTS chat_interactions (
  id              SERIAL PRIMARY KEY,
  contact_id      INTEGER NOT NULL REFERENCES contacts(id),
  message         TEXT NOT NULL,
  intent          VARCHAR(20) NOT NULL
                    CHECK (intent IN ('opt_in', 'opt_out', 'menu', 'faq_match', 'escalated', 'blocked_no_optin')),
  opportunity_id  INTEGER REFERENCES opportunities(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_interactions_intent ON chat_interactions(intent);
CREATE INDEX IF NOT EXISTS idx_chat_interactions_opportunity ON chat_interactions(opportunity_id);

-- RF-15 — o Administrador configura qual planilha e qual intervalo são
-- consumidos. Linha única (singleton), como um registro de configuração.
CREATE TABLE IF NOT EXISTS sheet_config (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  sheet_id    TEXT,
  sheet_range TEXT NOT NULL DEFAULT 'A:Z',
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
