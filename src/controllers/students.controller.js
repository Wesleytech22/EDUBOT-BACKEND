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

// Filtros compartilhados entre a listagem e a exportação em CSV.
// Multi-escola — sempre começa pela escola de quem está logado.
function buildFilters(query, schoolId) {
  const { search, grade, situation, schoolYear } = query;
  const params = [schoolId];
  const where = ['school_id = $1'];

  if (search) {
    params.push(`%${search}%`);
    where.push(`name ILIKE $${params.length}`);
  }
  if (grade && grade !== 'Todas') {
    params.push(grade);
    where.push(`grade = $${params.length}`);
  }
  if (situation && situation !== 'Todas') {
    params.push(situation);
    where.push(`situation = $${params.length}`);
  }
  if (schoolYear) {
    params.push(Number(schoolYear));
    where.push(`school_year = $${params.length}`);
  }

  return { clause: `WHERE ${where.join(' AND ')}`, params };
}

// Visualização consolidada dos alunos, com busca e filtros por série e
// situação. Somente leitura — a planilha da escola é a única fonte de escrita.
async function list(req, res, next) {
  try {
    const { clause, params } = buildFilters(req.query, req.schoolId);
    const { rows } = await pool.query(`SELECT * FROM students ${clause} ORDER BY name ASC`, params);
    const { rows: gradeRows } = await pool.query(
      'SELECT DISTINCT grade FROM students WHERE school_id = $1 ORDER BY grade ASC',
      [req.schoolId]
    );
    return res.json({ items: rows.map(serialize), total: rows.length, grades: gradeRows.map((r) => r.grade) });
  } catch (err) {
    return next(err);
  }
}

// Indicadores da turma: frequência média e desempenho geral (percentual de
// alunos em situação "Regular" — um indicador simples e honesto, sem
// inventar uma nota composta que a escola não tem).
async function summary(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(AVG(attendance), 0) AS avg_attendance,
              COUNT(*) FILTER (WHERE situation = 'Regular')::int AS regular,
              COUNT(*) FILTER (WHERE situation = 'Atenção')::int AS attention,
              COUNT(*) FILTER (WHERE situation = 'Risco')::int AS risk
       FROM students WHERE school_id = $1`,
      [req.schoolId]
    );
    const r = rows[0];
    return res.json({
      totalStudents: r.total,
      averageAttendance: Math.round(Number(r.avg_attendance) * 10) / 10,
      regularRate: r.total ? Math.round((r.regular / r.total) * 100) : 0,
      bySituation: { Regular: r.regular, Atenção: r.attention, Risco: r.risk },
    });
  } catch (err) {
    return next(err);
  }
}

// Próxima sincronização automática: a rotina conta o intervalo a partir da
// última tentativa (manual ou automática). Sem tentativa ainda, vale "agora"
// — o próximo ciclo da rotina já sincroniza.
function nextSyncAt(config, lastRun) {
  if (!config || config.sync_interval_minutes <= 0) return null;
  if (!lastRun) return new Date();
  return new Date(new Date(lastRun.created_at).getTime() + config.sync_interval_minutes * 60 * 1000);
}

// Data/hora da última sincronização bem-sucedida, a última tentativa (para
// sinalizar falha no topo do painel) e quando será a próxima automática.
async function syncStatus(req, res, next) {
  try {
    const { rows: lastSuccess } = await pool.query(
      "SELECT created_at FROM sync_runs WHERE school_id = $1 AND status = 'sucesso' ORDER BY created_at DESC LIMIT 1",
      [req.schoolId]
    );
    const { rows: lastRun } = await pool.query(
      'SELECT * FROM sync_runs WHERE school_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.schoolId]
    );
    const { rows: config } = await pool.query(
      'SELECT source, sheet_id, uploaded_rows, sync_interval_minutes FROM sheet_config WHERE school_id = $1',
      [req.schoolId]
    );
    const c = config[0];
    const configured = Boolean(c && (c.source === 'upload' ? c.uploaded_rows : c.sheet_id));
    const automatic = configured && String(process.env.SHEET_SYNC_ENABLED).toLowerCase() !== 'false';

    return res.json({
      configured,
      syncIntervalMinutes: c?.sync_interval_minutes ?? 0,
      nextSyncAt: automatic ? nextSyncAt(c, lastRun[0]) : null,
      lastSuccessfulSyncAt: lastSuccess[0]?.created_at || null,
      lastRun: lastRun[0]
        ? {
            status: lastRun[0].status,
            trigger: lastRun[0].trigger_type,
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

// Sincronização imediata, além da rotina automática.
async function triggerSync(req, res, next) {
  try {
    const result = await syncStudentsFromSheet({ schoolId: req.schoolId, trigger: 'manual' });
    return res.status(result.status === 'sucesso' ? 200 : 502).json(result);
  } catch (err) {
    return next(err);
  }
}

// Aspas quando necessário e apóstrofo antes de =, +, - ou @ — evita que um
// nome vindo da planilha seja interpretado como fórmula ao abrir no Excel.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Exportação em CSV com os mesmos filtros da tela. Ponto e vírgula e BOM
// para o Excel em português abrir com acentos e colunas certos.
async function exportCsv(req, res, next) {
  try {
    const { clause, params } = buildFilters(req.query, req.schoolId);
    const { rows } = await pool.query(`SELECT * FROM students ${clause} ORDER BY name ASC`, params);

    const header = ['Nome', 'Série', 'Presenças', 'Faltas', 'Frequência (%)', 'Situação', 'Última atualização'];
    const lines = rows.map((r) =>
      [
        r.name,
        r.grade,
        r.attendance_present,
        r.attendance_absent,
        Number(r.attendance).toFixed(1).replace('.', ','),
        r.situation,
        new Date(r.synced_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      ]
        .map(csvCell)
        .join(';')
    );

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="painel-escolar-${date}.csv"`);
    return res.send(`﻿${[header.join(';'), ...lines].join('\r\n')}\r\n`);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, summary, syncStatus, triggerSync, exportCsv };
