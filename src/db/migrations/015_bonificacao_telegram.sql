-- EduBot — Sprint 05 — Bonificação do aluno que interage pelo Telegram.

-- A planilha pode trazer o contato do aluno (coluna E). Quando esse número
-- entra no bot do Telegram e compartilha o telefone, o aluno do Painel
-- Escolar passa a acumular pontos pelas interações.
--
-- O telefone chega em formatos diferentes: o Telegram grava "+5592999999999",
-- a planilha pode trazer "(92) 99999-9999" ou um celular antigo sem o 9. A
-- chave de comparação é DDD + últimos 8 dígitos (sem o 55 do país), calculada
-- pelo próprio banco nas duas tabelas. Menos de 10 dígitos = sem chave.
CREATE OR REPLACE FUNCTION phone_match_key(raw TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(local) >= 10 THEN left(local, 2) || right(local, 8) END
  FROM (
    SELECT CASE WHEN length(d) >= 12 AND left(d, 2) = '55' THEN substr(d, 3) ELSE d END AS local
    FROM (SELECT regexp_replace(COALESCE(raw, ''), '\D', '', 'g') AS d) digits
  ) br
$$;

ALTER TABLE students ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(30);
ALTER TABLE students ADD COLUMN IF NOT EXISTS contact_key VARCHAR(10)
  GENERATED ALWAYS AS (phone_match_key(contact_phone)) STORED;
CREATE INDEX IF NOT EXISTS idx_students_contact_key ON students(school_id, contact_key);

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_key VARCHAR(10)
  GENERATED ALWAYS AS (phone_match_key(phone)) STORED;
CREATE INDEX IF NOT EXISTS idx_contacts_phone_key ON contacts(school_id, phone_key);

CREATE INDEX IF NOT EXISTS idx_chatbot_messages_contact ON chatbot_messages(contact_id);
