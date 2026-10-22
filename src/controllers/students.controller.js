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
    contactPhone: row.contact_phone,
    bonus: {
      points: row.bonus_points,
      telegramLinked: row.telegram_linked,
      interactions: row.interactions,
      lastInteractionAt: row.last_interaction_at,
    },
  };
}

// Bonificação: o aluno cujo Contato (planilha) é o mesmo telefone de um
// contato do bot ganha pontos por vincular o Telegram e por cada mensagem
// enviada ao bot. Calculada na leitura, então vale para quem entrar no bot
// a qualquer momento, sem esperar a próxima sincronização da planilha.
const LINK_POINTS = 10;
const INTERACTION_POINTS = 5;

const STUDENTS_WITH_BONUS = `(
  SELECT s.*,
         COALESCE(e.linked, false) AS telegram_linked,
         COALESCE(e.interactions, 0) AS interactions,
         e.last_interaction_at,
         (CASE WHEN e.linked THEN ${LINK_POINTS} ELSE 0 END
           + COALESCE(e.interactions, 0) * ${INTERACTION_POINTS})::int AS bonus_points
  FROM students s
  LEFT JOIN LATERAL (
    SELECT bool_or(c.telegram_chat_id IS NOT NULL) AS linked,
           COUNT(cm.id)::int AS interactions,
           MAX(cm.created_at) AS last_interaction_at
    FROM contacts c
    LEFT JOIN chatbot_messages cm ON cm.contact_id = c.id
    WHERE c.school_id = s.school_id AND c.phone_key = s.contact_key
  ) e ON true
) st`;

// Filtros compartilhados entre a listagem e a exportação em CSV.
// Multi-escola — sempre começa pela escola de quem está logado.
function buildFilters(query, schoolId) {
  const { search, grade, situation, schoolYear, engagement } = query;
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
  if (engagement === 'Engajados') where.push('bonus_points > 0');
  if (engagement === 'Não engajados') where.push('bonus_points = 0');

  return { clause: `WHERE ${where.join(' AND ')}`, params };
}

// Paginação da listagem: page começa em 1; pageSize só aceita os tamanhos
// oferecidos na tela (padrão 20), para ninguém pedir a base inteira de uma vez.
const PAGE_SIZES = [10, 20, 50, 100];

function parsePaging(query) {
  const pageSize = PAGE_SIZES.includes(Number(query.pageSize)) ? Number(query.pageSize) : 20;
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  return { page, pageSize };
}

// Visualização consolidada dos alunos, com busca, filtros por série e
// situação e paginação. Somente leitura — a planilha da escola é a única fonte de escrita.
async function list(req, res, next) {
  try {
    const { clause, params } = buildFilters(req.query, req.schoolId);
    const paging = parsePaging(req.query);
    const { pageSize } = paging;
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM ${STUDENTS_WITH_BONUS} ${clause}`,
      params
    );
    const total = countRows[0].total;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    // Página além do fim (ex.: um filtro reduziu o total) volta para a última.
    const page = Math.min(paging.page, totalPages);

    const { rows } = await pool.query(
      `SELECT * FROM ${STUDENTS_WITH_BONUS} ${clause} ORDER BY name ASC, id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    const { rows: gradeRows } = await pool.query(
      'SELECT DISTINCT grade FROM students WHERE school_id = $1 ORDER BY grade ASC',
      [req.schoolId]
    );
    return res.json({
      items: rows.map(serialize),
      total,
      page,
      pageSize,
      totalPages,
      grades: gradeRows.map((r) => r.grade),
    });
  } catch (err) {
    return next(err);
  }
}

// Indicadores dos cartões do Painel Escolar: frequência média e desempenho
// geral (percentual de alunos em situação "Regular" — um indicador simples e
// honesto, sem inventar uma nota composta que a escola não tem). Seguem os
// mesmos filtros da listagem (busca, série e situação), para os cartões
// mostrarem o recorte que está na tela; baseTotal é a escola inteira.
async function summary(req, res, next) {
  try {
    const { clause, params } = buildFilters(req.query, req.schoolId);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(AVG(attendance), 0) AS avg_attendance,
              COUNT(*) FILTER (WHERE situation = 'Regular')::int AS regular,
              COUNT(*) FILTER (WHERE situation = 'Atenção')::int AS attention,
              COUNT(*) FILTER (WHERE situation = 'Risco')::int AS risk,
              COUNT(*) FILTER (WHERE bonus_points > 0)::int AS engaged,
              COUNT(*) FILTER (WHERE contact_key IS NOT NULL)::int AS with_contact,
              COALESCE(SUM(bonus_points), 0)::int AS points
       FROM ${STUDENTS_WITH_BONUS} ${clause}`,
      params
    );
    const { rows: baseRows } = await pool.query('SELECT COUNT(*)::int AS total FROM students WHERE school_id = $1', [
      req.schoolId,
    ]);
    const { search, grade, situation, engagement } = req.query;
    const r = rows[0];
    return res.json({
      totalStudents: r.total,
      baseTotal: baseRows[0].total,
      filtered: Boolean(
        search ||
          (grade && grade !== 'Todas') ||
          (situation && situation !== 'Todas') ||
          (engagement && engagement !== 'Todos')
      ),
      averageAttendance: Math.round(Number(r.avg_attendance) * 10) / 10,
      regularRate: r.total ? Math.round((r.regular / r.total) * 100) : 0,
      bySituation: { Regular: r.regular, Atenção: r.attention, Risco: r.risk },
      bonus: { engaged: r.engaged, withContact: r.with_contact, points: r.points },
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
    const { rows } = await pool.query(`SELECT * FROM ${STUDENTS_WITH_BONUS} ${clause} ORDER BY name ASC`, params);

    const header = [
      'Nome',
      'Série',
      'Presenças',
      'Faltas',
      'Frequência (%)',
      'Situação',
      'Contato',
      'Telegram',
      'Interações',
      'Pontos',
      'Última atualização',
    ];
    const lines = rows.map((r) =>
      [
        r.name,
        r.grade,
        r.attendance_present,
        r.attendance_absent,
        Number(r.attendance).toFixed(1).replace('.', ','),
        r.situation,
        r.contact_phone,
        r.telegram_linked ? 'Vinculado' : 'Não vinculado',
        r.interactions,
        r.bonus_points,
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
