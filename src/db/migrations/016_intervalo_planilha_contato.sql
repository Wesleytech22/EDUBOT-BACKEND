-- EduBot — Sprint 05 — Intervalo da planilha até a coluna Contato (E).

-- A bonificação do Telegram (migration 015) depende do Contato do aluno, na
-- coluna E. Escolas que salvaram o intervalo terminando na coluna D ("A:D",
-- "Alunos!A2:D", "A1:D200") nunca recebem o Contato, e o painel mostra zero
-- engajados sem nenhum aviso. Estende só o fim do intervalo de D para E,
-- mantendo aba e linhas. Idempotente: depois de corrigido, não casa de novo.
UPDATE sheet_config
SET sheet_range = regexp_replace(sheet_range, ':\$?D(\$?\d*)$', ':E\1', 'i'),
    updated_at = now()
WHERE sheet_range ~* ':\$?D\$?\d*$';
