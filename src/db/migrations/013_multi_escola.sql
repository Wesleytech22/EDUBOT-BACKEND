-- EduBot — Sprint 05 — Multi-escola.
--
-- O Administrador da plataforma (perfil super_admin, equipe Lumen Forge, fora
-- de qualquer escola) cadastra as escolas e as contas de cada uma. Cada escola
-- tem o seu próprio controle de ponta a ponta: oportunidades, contatos,
-- disparo, chatbot, métricas, atendimento, planilha e Painel Escolar.
--
-- As tabelas que só dependem de outra já isolada (dispatch_logs,
-- consent_logs, chatbot_messages, support_requests, opportunity_attachments)
-- não ganham coluna própria: o isolamento vem de opportunities/contacts —
-- evita uma coluna redundante que poderia dessincronizar.

CREATE TABLE IF NOT EXISTS schools (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(150) NOT NULL,
  slug        VARCHAR(60) NOT NULL UNIQUE,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Escola que recebe tudo o que já existia antes do multi-escola, para não
-- quebrar a instalação atual. O Administrador da plataforma pode renomeá-la.
INSERT INTO schools (name, slug)
VALUES ('Escola Padrão', 'escola-padrao')
ON CONFLICT (slug) DO NOTHING;

-- Auditoria: cadastro de escolas e de contas pelo Administrador da plataforma
-- também vira registro em logs.
ALTER TABLE logs DROP CONSTRAINT IF EXISTS logs_type_check;
ALTER TABLE logs ADD CONSTRAINT logs_type_check CHECK (type IN ('acesso', 'disparo', 'escola'));

-- Usuários ----------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin', 'administrador', 'equipe_escola'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

UPDATE users SET school_id = (SELECT id FROM schools WHERE slug = 'escola-padrao')
WHERE school_id IS NULL AND role <> 'super_admin';

-- super_admin nunca tem escola; administrador e equipe_escola sempre têm.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_school_id_check;
ALTER TABLE users ADD CONSTRAINT users_school_id_check
  CHECK ((role = 'super_admin') = (school_id IS NULL));

CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);

-- Oportunidades -----------------------------------------------------------
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);
UPDATE opportunities SET school_id = (SELECT id FROM schools WHERE slug = 'escola-padrao')
WHERE school_id IS NULL;
ALTER TABLE opportunities ALTER COLUMN school_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_school ON opportunities(school_id);

-- Contatos ----------------------------------------------------------------
-- Cada contato pertence à lista de uma escola. O mesmo telefone (ou o mesmo
-- chat do Telegram) pode estar em mais de uma escola — uma família com
-- filhos em escolas diferentes —, então a unicidade passa a ser por escola.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);
UPDATE contacts SET school_id = (SELECT id FROM schools WHERE slug = 'escola-padrao')
WHERE school_id IS NULL;
ALTER TABLE contacts ALTER COLUMN school_id SET NOT NULL;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_phone_key;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_school_id_phone_key;
ALTER TABLE contacts ADD CONSTRAINT contacts_school_id_phone_key UNIQUE (school_id, phone);

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_telegram_chat_id_key;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_school_id_telegram_chat_id_key;
ALTER TABLE contacts ADD CONSTRAINT contacts_school_id_telegram_chat_id_key UNIQUE (school_id, telegram_chat_id);

CREATE INDEX IF NOT EXISTS idx_contacts_school ON contacts(school_id);

-- Telegram: um único bot atende todas as escolas. Cada chat conversa com uma
-- escola por vez — a escola do link de entrada (t.me/<bot>?start=<slug>) —
-- e guarda aqui o telefone compartilhado, para não pedir de novo ao trocar.
CREATE TABLE IF NOT EXISTS telegram_chats (
  chat_id     BIGINT PRIMARY KEY,
  school_id   UUID REFERENCES schools(id),
  phone       VARCHAR(20),
  name        VARCHAR(150),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO telegram_chats (chat_id, school_id, phone, name)
SELECT telegram_chat_id, school_id, phone, name FROM contacts
WHERE telegram_chat_id IS NOT NULL
ON CONFLICT (chat_id) DO NOTHING;

-- Planilha, alunos e sincronização ---------------------------------------
-- sheet_config deixa de ser uma linha única global (id = 1) e passa a ser
-- uma linha por escola (school_id como chave primária).
ALTER TABLE sheet_config ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);
UPDATE sheet_config SET school_id = (SELECT id FROM schools WHERE slug = 'escola-padrao')
WHERE school_id IS NULL;
ALTER TABLE sheet_config DROP CONSTRAINT IF EXISTS sheet_config_pkey;
ALTER TABLE sheet_config DROP CONSTRAINT IF EXISTS sheet_config_id_check;
ALTER TABLE sheet_config DROP COLUMN IF EXISTS id;
ALTER TABLE sheet_config ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE sheet_config ADD CONSTRAINT sheet_config_pkey PRIMARY KEY (school_id);

ALTER TABLE students ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);
UPDATE students SET school_id = (SELECT id FROM schools WHERE slug = 'escola-padrao')
WHERE school_id IS NULL;
ALTER TABLE students ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_name_grade_school_year_key;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_school_id_name_grade_school_year_key;
ALTER TABLE students ADD CONSTRAINT students_school_id_name_grade_school_year_key
  UNIQUE (school_id, name, grade, school_year);
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);

ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);
UPDATE sync_runs SET school_id = (SELECT id FROM schools WHERE slug = 'escola-padrao')
WHERE school_id IS NULL;
ALTER TABLE sync_runs ALTER COLUMN school_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sync_runs_school ON sync_runs(school_id, created_at DESC);
