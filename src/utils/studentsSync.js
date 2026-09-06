const pool = require('../db/pool');
const { resolveSheetRows } = require('./googleSheets');

// RF-16 — layout esperado da planilha, a partir da linha configurada em
// sheet_config.sheet_range (ex.: "Alunos!A2:E"): Nome | Série | Presenças |
// Faltas | Situação. Sem cabeçalho nas linhas lidas — o cabeçalho fica
// fora do intervalo configurado (no upload de CSV, a primeira linha é
// descartada à parte, em csvParser.js). A coordenação registra números
// inteiros de presenças/faltas — a frequência (%) é sempre calculada pelo
// sistema, nunca digitada diretamente.
function parseCount(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  const normalized = String(raw).replace(',', '.').trim();
  const value = Number.parseInt(normalized, 10);
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

async function upsertStudent(row) {
  const [name, grade, presentRaw, absentRaw, situationRaw] = row;
  if (!name || !grade) return false;

  const present = parseCount(presentRaw);
  const absent = parseCount(absentRaw);
  const attendance = calculateAttendance(present, absent);

  await pool.query(
    `INSERT INTO students (name, grade, attendance, attendance_present, attendance_absent, situation, school_year, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, EXTRACT(YEAR FROM now()), now())
     ON CONFLICT (name, grade, school_year) DO UPDATE SET
       attendance = EXCLUDED.attendance,
       attendance_present = EXCLUDED.attendance_present,
       attendance_absent = EXCLUDED.attendance_absent,
       situation = EXCLUDED.situation,
       synced_at = now()`,
    [String(name).trim(), String(grade).trim(), attendance, present, absent, parseSituation(situationRaw)]
  );
  return true;
}

// RF-16, RF-17 — lê a planilha configurada (Módulo F, nos dois modos —
// link ou arquivo anexado) e sincroniza a tabela students, registrando o
// resultado (sucesso/falha) em sync_runs.
async function syncStudentsFromSheet() {
  const { rows: configRows } = await pool.query('SELECT * FROM sheet_config WHERE id = 1');
  const config = configRows[0];

  try {
    const { values } = await resolveSheetRows(config);
    let synced = 0;
    for (const row of values) {
      if (await upsertStudent(row)) synced += 1;
    }

    await pool.query(
      "INSERT INTO sync_runs (status, rows_synced, detail) VALUES ('sucesso', $1, $2)",
      [synced, `${synced} de ${values.length} linha(s) sincronizada(s).`]
    );
    return { status: 'sucesso', rowsSynced: synced };
  } catch (err) {
    await pool.query(
      "INSERT INTO sync_runs (status, rows_synced, detail) VALUES ('falha', 0, $1)",
      [err.message]
    );
    return { status: 'falha', rowsSynced: 0, detail: err.message };
  }
}

module.exports = { syncStudentsFromSheet, calculateAttendance };
