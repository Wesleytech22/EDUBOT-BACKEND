-- EduBot — Sprint 05 — Situação do aluno calculada pelo sistema.

-- A situação deixa de vir da planilha e passa a ser derivada da frequência,
-- como já acontece com a frequência (%): Risco abaixo de 75% (mínimo da
-- LDB), Atenção abaixo de 85% e Regular a partir disso. Aluno sem nenhuma
-- presença/falta registrada fica Regular. Recalcula os alunos já
-- sincronizados para o painel não esperar a próxima sincronização.
-- Manter em sincronia com calculateSituation (src/utils/studentsSync.js).
UPDATE students
SET situation = CASE
  WHEN attendance_present + attendance_absent = 0 THEN 'Regular'
  WHEN attendance < 75 THEN 'Risco'
  WHEN attendance < 85 THEN 'Atenção'
  ELSE 'Regular'
END;
