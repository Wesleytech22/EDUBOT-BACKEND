-- EduBot — Sprint 04 (branch de avaliação do canal Telegram) — vincula o
-- contato (identificado pelo telefone) ao chat do Telegram. O vínculo nasce
-- quando a pessoa toca em "Compartilhar meu número" no bot.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT UNIQUE;
