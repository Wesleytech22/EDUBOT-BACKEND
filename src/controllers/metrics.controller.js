const pool = require('../db/pool');

function buildFilters({ opportunityId, from, to }) {
  const conditions = [];
  const params = [];

  if (opportunityId) {
    params.push(opportunityId);
    conditions.push(`dl.opportunity_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`dl.created_at >= $${params.length}`);
  }
  if (to) {
    // 'to' é uma data (AAAA-MM-DD) inclusiva: considera o dia inteiro.
    params.push(to);
    conditions.push(`dl.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  return { conditions, params };
}

// RF-37 — métricas de envio, recortáveis por oportunidade e por período
// (Tela 06). Escopo Sprint 03: só dados reais de disparo (dispatch_logs).
// Dúvidas frequentes e taxa de resposta (RF-39) dependem do chatbot
// (Módulo C/D), entregue na Sprint 04 — por isso "chatbot" volta null.
async function getDispatchMetrics(filters) {
  const { conditions, params } = buildFilters(filters);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT dl.status, COUNT(*)::int AS count FROM dispatch_logs dl ${where} GROUP BY dl.status`,
    params
  );
  const byStatus = { pendente: 0, enviado: 0, falha: 0 };
  rows.forEach((r) => {
    byStatus[r.status] = r.count;
  });
  const totalSent = byStatus.pendente + byStatus.enviado + byStatus.falha;

  const reachedConditions = [...conditions, `dl.status = 'enviado'`];
  const { rows: reachedRows } = await pool.query(
    `SELECT COUNT(DISTINCT dl.contact_id)::int AS count FROM dispatch_logs dl WHERE ${reachedConditions.join(' AND ')}`,
    params
  );

  return {
    totalNotifications: totalSent,
    delivered: byStatus.enviado,
    failed: byStatus.falha,
    pending: byStatus.pendente,
    contactsReached: reachedRows[0].count,
    deliveryRate: totalSent > 0 ? Math.round((byStatus.enviado / totalSent) * 100) : 0,
  };
}

// RF-38 — envios por semana com o status de entrega consolidado, para o
// gráfico da Tela 06.
async function getWeeklySeries(filters) {
  const { conditions, params } = buildFilters(filters);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT date_trunc('week', dl.created_at)::date AS week, dl.status, COUNT(*)::int AS count
     FROM dispatch_logs dl
     ${where}
     GROUP BY week, dl.status
     ORDER BY week ASC`,
    params
  );

  const byWeek = new Map();
  rows.forEach((r) => {
    const key = r.week.toISOString().slice(0, 10);
    if (!byWeek.has(key)) byWeek.set(key, { week: key, enviado: 0, falha: 0, pendente: 0 });
    byWeek.get(key)[r.status] = r.count;
  });

  return [...byWeek.values()];
}

// RF-37, RF-38 — painel de métricas consolidado (Tela 06).
async function getOverview(req, res, next) {
  try {
    const { opportunityId, from, to } = req.query;
    const filters = { opportunityId, from, to };
    const [dispatch, weeklySeries] = await Promise.all([
      getDispatchMetrics(filters),
      getWeeklySeries(filters),
    ]);
    return res.json({ dispatch, weeklySeries, chatbot: null });
  } catch (err) {
    return next(err);
  }
}

// RF-37 — status de entrega de cada notificação, através de todas as
// oportunidades (rastreabilidade total, RNF-07), recortável por
// oportunidade e por período.
async function listAllDispatchLogs(req, res, next) {
  try {
    const { opportunityId, from, to } = req.query;
    const { conditions, params } = buildFilters({ opportunityId, from, to });
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT dl.id, dl.status, dl.detail, dl.created_at, dl.updated_at,
              o.id AS opportunity_id, o.title AS opportunity_title,
              c.id AS contact_id, c.name AS contact_name, c.phone AS contact_phone
       FROM dispatch_logs dl
       JOIN opportunities o ON o.id = dl.opportunity_id
       JOIN contacts c ON c.id = dl.contact_id
       ${where}
       ORDER BY dl.created_at DESC
       LIMIT 200`,
      params
    );

    return res.json({
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        detail: row.detail,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        opportunity: { id: row.opportunity_id, title: row.opportunity_title },
        contact: { id: row.contact_id, name: row.contact_name, phone: row.contact_phone },
      })),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getOverview, listAllDispatchLogs };
