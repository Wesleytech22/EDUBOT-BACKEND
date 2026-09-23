-- EduBot — Sprint 04 — registro das mensagens recebidas pelo chatbot, com a
-- intenção identificada. Alimenta as métricas de engajamento da Tela 06:
-- respostas recebidas (RF-38), dúvidas mais frequentes (RF-39) e taxa de
-- resposta por oportunidade.
CREATE TABLE IF NOT EXISTS chatbot_messages (
  id              SERIAL PRIMARY KEY,
  contact_id      INTEGER NOT NULL REFERENCES contacts(id),
  message         TEXT NOT NULL,
  intent          VARCHAR(30) NOT NULL
                    CHECK (intent IN ('opt_in', 'opt_out', 'sem_consentimento', 'menu',
                                      'atendente', 'faq_oportunidade', 'nao_resolvido')),
  opportunity_id  INTEGER REFERENCES opportunities(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chatbot_messages_created ON chatbot_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chatbot_messages_opportunity ON chatbot_messages(opportunity_id);
