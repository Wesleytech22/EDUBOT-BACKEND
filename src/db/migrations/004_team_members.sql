-- Tela "Sobre Nós" — créditos dos desenvolvedores do projeto.
CREATE TABLE IF NOT EXISTS team_members (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(150) NOT NULL UNIQUE,
  role           VARCHAR(150) NOT NULL,
  bio            TEXT NOT NULL,
  photo_data_url TEXT,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
