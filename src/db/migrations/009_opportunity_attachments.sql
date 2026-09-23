-- EduBot — Hotfix (produção): anexo real da oportunidade (RF-01)
-- O campo "Anexo (opcional)" era só o nome digitado de um arquivo
-- (opportunities.attachment_name). Agora o arquivo é enviado de verdade e
-- guardado no banco — o disco do Render é efêmero e se perde a cada deploy.
-- Numerada como 009 para não colidir com as migrations 006–008 da Sprint 04.
-- Um anexo por oportunidade; attachment_name continua guardando o nome exibido.

CREATE TABLE IF NOT EXISTS opportunity_attachments (
  opportunity_id INTEGER PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE,
  file_name      TEXT NOT NULL,
  mime_type      VARCHAR(100) NOT NULL,
  size_bytes     INTEGER NOT NULL,
  data           BYTEA NOT NULL,
  uploaded_by    UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
