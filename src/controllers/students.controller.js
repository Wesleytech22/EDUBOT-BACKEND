const pool = require('../db/pool');
const { syncStudentsFromSheet } = require('../utils/studentsSync');

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    grade: row.grade,
    attendance: Number(row.attendance),
    attendancePresent: row.attendance_present,
    attendanceAbsent: row.attendance_absent,
    situation: row.situation,
    schoolYear: row.school_year,
    syncedAt: row.synced_at,
  };
}

// RF-18 — visualização consolidada dos alunos, com busca e filtros por
// série, ano e situação. Somente leitura — a planilha da escola permanece
// a única fonte de escrita (seção 5.7 do Documento de Escopo).
async function list(req, res, next) {
  try {
    const { search, grade, situation, schoolYear } = req.query;
    const { rows } = await pool.query('SELECT * FROM students ORDER BY name ASC');

    let items = rows.map(serialize);

    if (search) {
      const term = search.toLowerCase();
      items = items.filter((s) => s.name.toLowerCase().includes(term));
    }
    if (grade && grade !== 'Todas') {
      items = items.filter((s) => s.grade === grade);
    }
    if (situation && situation !== 'Todas') {
      items = items.filter((s) => s.situation === situation);
    }
    if (schoolYear) {
      items = items.filter((s) => String(s.schoolYear) === String(schoolYear));
    }

    return res.json({ items, total: items.length });
  } catch (err) {
    return next(err);
  }
}

// RF-19 — indicadores agregados da turma: frequência média e desempenho
// geral (aqui, percentual de alunos em situação "Regular" — um indicador
// simples e honesto, sem inventar uma nota composta que a escola não tem).
async function summary(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT attendance, situation FROM students');

    if (rows.length === 0) {
      return res.json({ totalStudents: 0, averageAttendance: 0, regularRate: 0 });
    }

    const totalStudents = rows.length;
    const averageAttendance =
      rows.reduce((sum, r) => sum + Number(r.attendance), 0) / totalStudents;
    const regularCount = rows.filter((r) => r.situation === 'Regular').length;

    return res.json({
      totalStudents,
      averageAttendance: Math.round(averageAttendance * 10) / 10,
      regularRate: Math.round((regularCount / totalStudents) * 100),
    });
  } catch (err) {
    return next(err);
  }
}

// RF-17 — data/hora da última sincronização bem-sucedida e sinalização de
// falhas.
async function syncStatus(req, res, next) {
  try {
    const { rows: lastSuccess } = await pool.query(
      "SELECT * FROM sync_runs WHERE status = 'sucesso' ORDER BY created_at DESC LIMIT 1"
    );
    const { rows: lastRun } = await pool.query(
      'SELECT * FROM sync_runs ORDER BY created_at DESC LIMIT 1'
    );

    return res.json({
      lastSuccessfulSyncAt: lastSuccess[0]?.created_at || null,
      lastRun: lastRun[0]
        ? {
            status: lastRun[0].status,
            rowsSynced: lastRun[0].rows_synced,
            detail: lastRun[0].detail,
            createdAt: lastRun[0].created_at,
          }
        : null,
    });
  } catch (err) {
    return next(err);
  }
}

// RF-16 — disparo manual da sincronização (além da rotina periódica em
// server.js), útil para testes e para o Administrador forçar uma
// atualização imediata.
async function triggerSync(req, res, next) {
  try {
    const result = await syncStudentsFromSheet();
    const status = result.status === 'sucesso' ? 200 : 502;
    return res.status(status).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, summary, syncStatus, triggerSync };
