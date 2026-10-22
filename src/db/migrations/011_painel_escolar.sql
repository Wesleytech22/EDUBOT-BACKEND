-- EduBot — Sprint 05 — Sincronização dos dados da planilha e Painel Escolar.

-- Frequência da sincronização automática, escolhida pelo Administrador na
-- tela de Integração. 0 = só sincroniza quando alguém clica em
-- "Sincronizar agora".
ALTER TABLE sheet_config
  ADD COLUMN IF NOT EXISTS sync_interval_minutes INTEGER NOT NULL DEFAULT 60
    CHECK (sync_interval_minutes >= 0);

-- Espelho somente leitura da planilha da escola. A coordenação registra
-- presenças e faltas (números inteiros); a frequência (%) é sempre
-- calculada pelo sistema. "name" + "grade" + "school_year" é a chave natural
-- do upsert entre sincronizações (a planilha não traz um ID estável).
CREATE TABLE IF NOT EXISTS students (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(150) NOT NULL,
  grade               VARCHAR(50) NOT NULL,
  attendance_present  INTEGER NOT NULL DEFAULT 0,
  attendance_absent   INTEGER NOT NULL DEFAULT 0,
  attendance          NUMERIC(5,2) NOT NULL DEFAULT 0,
  situation           VARCHAR(20) NOT NULL DEFAULT 'Regular'
                        CHECK (situation IN ('Regular', 'Atenção', 'Risco')),
  school_year         INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, grade, school_year)
);

CREATE INDEX IF NOT EXISTS idx_students_grade ON students(grade);
CREATE INDEX IF NOT EXISTS idx_students_situation ON students(situation);

-- Histórico de sincronizações: sucessos e falhas ficam visíveis lado a lado,
-- com a data/hora da última sincronização bem-sucedida.
CREATE TABLE IF NOT EXISTS sync_runs (
  id            SERIAL PRIMARY KEY,
  status        VARCHAR(10) NOT NULL CHECK (status IN ('sucesso', 'falha')),
  trigger_type  VARCHAR(12) NOT NULL DEFAULT 'manual'
                  CHECK (trigger_type IN ('manual', 'automatica')),
  rows_synced   INTEGER NOT NULL DEFAULT 0,
  rows_skipped  INTEGER NOT NULL DEFAULT 0,
  detail        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_created_at ON sync_runs(created_at DESC);
