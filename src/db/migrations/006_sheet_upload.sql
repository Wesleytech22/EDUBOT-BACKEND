-- EduBot — Sprint 05 (ajuste) — Módulo F: permite anexar um arquivo CSV
-- exportado da planilha como alternativa à leitura ao vivo pela API do
-- Google Sheets, para escolas que preferem não compartilhar o link.

ALTER TABLE sheet_config
  ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'api'
    CHECK (source IN ('api', 'upload')),
  ADD COLUMN IF NOT EXISTS uploaded_filename TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_rows JSONB,
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ;
