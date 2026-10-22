-- EduBot — Sprint 05 — Segurança da informação: histórico da rotina de
-- backup do Postgres, exibido ao Administrador na tela "Segurança · Backups".
-- Só metadados — o dump em si fica em BACKUP_DIR e nunca é servido pela API.
CREATE TABLE IF NOT EXISTS backup_runs (
  id             SERIAL PRIMARY KEY,
  status         VARCHAR(10) NOT NULL CHECK (status IN ('sucesso', 'falha')),
  trigger_type   VARCHAR(12) NOT NULL DEFAULT 'automatico'
                   CHECK (trigger_type IN ('manual', 'automatico')),
  file_name      TEXT,
  size_bytes     BIGINT,
  removed_count  INTEGER NOT NULL DEFAULT 0,
  detail         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_created_at ON backup_runs(created_at DESC);
