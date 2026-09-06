-- EduBot — Multi-escola (extensão): isola por escola as entidades "raiz"
-- que faltavam — contatos, alunos, execuções de sincronização e a
-- configuração da planilha. As tabelas que só dependem dessas (dispatch_logs,
-- chat_interactions, consent_logs, support_requests) continuam sem coluna
-- própria: o isolamento delas vem de JOIN com opportunities/contacts, que já
-- pertencem a uma escola — evita coluna redundante que poderia dessincronizar.

-- RF-04, RF-10 — cada contato pertence à lista de distribuição de uma
-- escola. O mesmo telefone pode existir em mais de uma escola (ex.: uma
-- família com filhos em escolas diferentes) — por isso o telefone deixa
-- de ser único globalmente e passa a ser único por escola.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);

UPDATE contacts SET school_id = (SELECT id FROM schools WHERE slug = 'escola-padrao')
WHERE school_id IS NULL;

ALTER TABLE contacts ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_phone_key;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_school_id_phone_key;
ALTER TABLE contacts ADD CONSTRAINT contacts_school_id_phone_key UNIQUE (school_id, phone);

-- RF-18 — cada aluno pertence à base de uma escola; o nome deixa de ser
-- chave natural global e passa a ser único só dentro da escola.
ALTER TABLE students ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);

UPDATE students SET school_id = (SELECT id FROM schools WHERE slug = 'escola-padrao')
WHERE school_id IS NULL;

ALTER TABLE students ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_name_grade_school_year_key;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_school_id_name_grade_school_year_key;
ALTER TABLE students ADD CONSTRAINT students_school_id_name_grade_school_year_key
  UNIQUE (school_id, name, grade, school_year);

-- RF-17 — cada escola tem seu próprio histórico de sincronização.
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);

UPDATE sync_runs SET school_id = (SELECT id FROM schools WHERE slug = 'escola-padrao')
WHERE school_id IS NULL;

ALTER TABLE sync_runs ALTER COLUMN school_id SET NOT NULL;

-- RF-15 — sheet_config deixa de ser uma linha única global (id = 1) e
-- passa a ser uma linha por escola (school_id como chave primária).
ALTER TABLE sheet_config ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);

UPDATE sheet_config SET school_id = (SELECT id FROM schools WHERE slug = 'escola-padrao')
WHERE school_id IS NULL;

ALTER TABLE sheet_config DROP CONSTRAINT IF EXISTS sheet_config_pkey;
ALTER TABLE sheet_config DROP CONSTRAINT IF EXISTS sheet_config_id_check;
ALTER TABLE sheet_config ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE sheet_config DROP COLUMN IF EXISTS id;
ALTER TABLE sheet_config ADD CONSTRAINT sheet_config_pkey PRIMARY KEY (school_id);

CREATE INDEX IF NOT EXISTS idx_contacts_school ON contacts(school_id);
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_school ON sync_runs(school_id);
