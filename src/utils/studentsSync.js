const pool = require('../db/pool');
const { resolveSheetRows } = require('./googleSheets');

// Layout esperado da planilha (colunas A a E): Nome | Série | Presenças |
// Faltas | Situação. A linha de cabeçalho, se vier, é reconhecida e
// ignorada. A coordenação registra números inteiros de presenças/faltas —
// a frequência (%) é sempre calculada pelo sistema, nunca digitada.
const HEADER_NAMES = ['nome', 'aluno', 'nome do aluno', 'estudante'];

function isHeaderRow(row) {
  return HEADER_NAMES.includes(String(row?.[0] || '').trim().toLowerCase());
}

function parseCount(raw) {
  const value = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isNaN(value) || value < 0 ? 0 : value;
}

function calculateAttendance(present, absent) {
  const total = present + absent;
  if (total === 0) return 0;
  return Math.round((present / total) * 1000) / 10;
}

function parseSituation(raw) {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized.startsWith('risco')) return 'Risco';
  if (normalized.startsWith('atenc') || normalized.startsWith('atenç')) return 'Atenção';
  return 'Regular';
}

function toStudent(row) {
  const [name, grade, presentRaw, absentRaw, situationRaw] = row || [];
  const cleanName = String(name || '').trim();
  const cleanGrade = String(grade || '').trim();
  if (!cleanName || !cleanGrade) return null;

  const present = parseCount(presentRaw);
  const absent = parseCount(absentRaw);
  return {
    name: cleanName.slice(0, 150),
    grade: cleanGrade.slice(0, 50),
    present,
    absent,
    attendance: calculateAttendance(present, absent),
    situation: parseSituation(situationRaw),
  };
}

// Separa cabeçalho, alunos válidos e linhas ignoradas — usado tanto pela
// sincronização quanto para recusar um CSV sem nenhum aluno antes de salvar.
function extractStudents(values) {
  const dataRows = values.length > 0 && isHeaderRow(values[0]) ? values.slice(1) : values;
  const students = dataRows.map(toStudent).filter(Boolean);
  return { students, skipped: dataRows.length - students.length };
}

const NO_VALID_ROWS_MESSAGE =
  'A planilha não trouxe nenhum aluno válido. Confira se as colunas seguem a ordem Nome, Série, Presenças, Faltas e Situação.';

// Lê a planilha configurada (link ou arquivo anexado) e espelha a tabela
// students numa transação: atualiza quem está na planilha e remove do ano
// corrente quem saiu dela, para o painel nunca mostrar aluno que a escola
// já tirou da planilha. Uma leitura sem nenhuma linha válida é tratada como
// falha — evita apagar o painel inteiro por causa de uma aba ou intervalo
// errado. Todo resultado (sucesso/falha) vira uma linha em sync_runs.
let running = false;

async function syncStudentsFromSheet({ trigger = 'manual' } = {}) {
  if (running) {
    return { status: 'falha', rowsSynced: 0, detail: 'Já existe uma sincronização em andamento.' };
  }
  running = true;

  try {
    const { rows: configRows } = await pool.query('SELECT * FROM sheet_config WHERE id = 1');
    const { values } = await resolveSheetRows(configRows[0]);

    const { students, skipped } = extractStudents(values);
    if (students.length === 0) {
      throw Object.assign(new Error(NO_VALID_ROWS_MESSAGE), { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: startRows } = await client.query('SELECT now() AS started_at');
      for (const s of students) {
        await client.query(
          `INSERT INTO students (name, grade, attendance, attendance_present, attendance_absent, situation, school_year, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, EXTRACT(YEAR FROM now()), now())
           ON CONFLICT (name, grade, school_year) DO UPDATE SET
             attendance = EXCLUDED.attendance,
             attendance_present = EXCLUDED.attendance_present,
             attendance_absent = EXCLUDED.attendance_absent,
             situation = EXCLUDED.situation,
             synced_at = now()`,
          [s.name, s.grade, s.attendance, s.present, s.absent, s.situation]
        );
      }
      await client.query(
        'DELETE FROM students WHERE school_year = EXTRACT(YEAR FROM now()) AND synced_at < $1',
        [startRows[0].started_at]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const detail =
      skipped > 0
        ? `${students.length} aluno(s) sincronizado(s); ${skipped} linha(s) ignorada(s) sem nome ou série.`
        : `${students.length} aluno(s) sincronizado(s).`;
    await pool.query(
      "INSERT INTO sync_runs (status, trigger_type, rows_synced, rows_skipped, detail) VALUES ('sucesso', $1, $2, $3, $4)",
      [trigger, students.length, skipped, detail]
    );
    return { status: 'sucesso', rowsSynced: students.length, rowsSkipped: skipped, detail };
  } catch (err) {
    await pool
      .query("INSERT INTO sync_runs (status, trigger_type, detail) VALUES ('falha', $1, $2)", [trigger, err.message])
      .catch((logErr) => console.error('[sync] não foi possível registrar a falha:', logErr.message));
    return { status: 'falha', rowsSynced: 0, detail: err.message };
  } finally {
    running = false;
  }
}

module.exports = { syncStudentsFromSheet, extractStudents, calculateAttendance, NO_VALID_ROWS_MESSAGE };
