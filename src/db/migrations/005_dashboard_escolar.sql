-- EduBot — Sprint 06 — Módulo G (Sincronização de Dados, RF-16/17) e
-- Módulo H (Dashboard Escolar, RF-18/19).

-- RF-18 — dados dos alunos em visualização consolidada. "nome" é usado como
-- chave natural de upsert entre sincronizações (a planilha não traz um ID
-- estável) — limitação aceitável para o escopo do MVP com uma única escola.
CREATE TABLE IF NOT EXISTS students (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,
  grade         VARCHAR(50) NOT NULL,
  attendance    NUMERIC(5,2) NOT NULL DEFAULT 0,
  situation     VARCHAR(20) NOT NULL DEFAULT 'Regular'
                  CHECK (situation IN ('Regular', 'Atenção', 'Risco')),
  school_year   INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, grade, school_year)
);

-- RF-17 — data/hora da última sincronização bem-sucedida e sinalização de
-- falhas: cada tentativa (sucesso ou falha) vira uma linha aqui.
CREATE TABLE IF NOT EXISTS sync_runs (
  id            SERIAL PRIMARY KEY,
  status        VARCHAR(10) NOT NULL CHECK (status IN ('sucesso', 'falha')),
  rows_synced   INTEGER NOT NULL DEFAULT 0,
  detail        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_students_grade ON students(grade);
CREATE INDEX IF NOT EXISTS idx_students_situation ON students(situation);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON sync_runs(status);
