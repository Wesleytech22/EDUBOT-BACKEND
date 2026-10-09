-- EduBot — Sprint 05 — Integração com o Google Sheets.
-- O Administrador configura, pela própria plataforma, de onde vêm os dados
-- escolares: o link de uma planilha do Google Sheets (leitura ao vivo) ou um
-- arquivo CSV exportado dela, para escolas que preferem não compartilhar o
-- link. Linha única (singleton), como um registro de configuração.
CREATE TABLE IF NOT EXISTS sheet_config (
  id                     INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  source                 VARCHAR(10) NOT NULL DEFAULT 'api'
                           CHECK (source IN ('api', 'upload')),
  sheet_id               TEXT,
  sheet_range            TEXT NOT NULL DEFAULT 'A:E',
  uploaded_filename      TEXT,
  uploaded_rows          JSONB,
  uploaded_at            TIMESTAMPTZ,
  updated_by             UUID REFERENCES users(id),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
