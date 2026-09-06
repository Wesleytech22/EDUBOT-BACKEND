-- EduBot — Multi-escola: cada escola tem seu próprio login de coordenação
-- e suas próprias oportunidades. Um novo papel "super_admin" (equipe
-- técnica, fora de qualquer escola) cadastra as escolas e a primeira
-- conta de Administrador de cada uma — mantém o espírito do RF-20 (sem
-- autocadastro público), só adiciona um nível acima.

CREATE TABLE IF NOT EXISTS schools (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(150) NOT NULL,
  slug        VARCHAR(60) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Escola "guarda-chuva" para não quebrar instalações que já tinham dados
-- antes do multi-tenant — todo usuário/oportunidade existente é migrado
-- para ela; a equipe pode renomear ou trocar depois.
INSERT INTO schools (name, slug)
VALUES ('Escola Padrão', 'escola-padrao')
ON CONFLICT (slug) DO NOTHING;

-- RF-20 (ajuste) — novo papel super_admin, sem vínculo com nenhuma escola.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin', 'administrador', 'equipe_escola'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);

UPDATE users SET school_id = (SELECT id FROM schools WHERE slug = 'escola-padrao')
WHERE school_id IS NULL AND role <> 'super_admin';

-- super_admin nunca tem escola; administrador/equipe_escola sempre têm.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_school_id_check;
ALTER TABLE users ADD CONSTRAINT users_school_id_check
  CHECK (
    (role = 'super_admin' AND school_id IS NULL) OR
    (role <> 'super_admin' AND school_id IS NOT NULL)
  );

-- RF-01 a RF-03 (ajuste) — cada oportunidade pertence a uma única escola;
-- a listagem/edição/disparo passam a ser sempre filtrados por ela.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);

UPDATE opportunities SET school_id = (SELECT id FROM schools WHERE slug = 'escola-padrao')
WHERE school_id IS NULL;

ALTER TABLE opportunities ALTER COLUMN school_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_school ON opportunities(school_id);
