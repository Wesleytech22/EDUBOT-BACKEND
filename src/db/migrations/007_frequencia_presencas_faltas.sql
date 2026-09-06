-- EduBot — Sprint 06 (ajuste) — Módulo H: a coordenação registra
-- presenças e faltas (números inteiros), não a porcentagem — o sistema
-- calcula a frequência a partir deles.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS attendance_present INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attendance_absent INTEGER NOT NULL DEFAULT 0;

-- "attendance" (percentual) passa a ser derivado de present/absent em
-- todo upsert (ver studentsSync.js); a coluna continua existindo, só para
-- não recalcular a cada leitura de listagem/resumo.
