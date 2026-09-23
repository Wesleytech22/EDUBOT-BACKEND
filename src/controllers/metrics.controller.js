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

// Mesmos filtros de buildFilters, aplicados a chatbot_messages (alias cm).
function buildMessageFilters({ opportunityId, from, to }) {
  const conditions = [];
  const params = [];

  if (opportunityId) {
    params.push(opportunityId);
    conditions.push(`cm.opportunity_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`cm.created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`cm.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  return { conditions, params };
}

const INTENT_LABEL = {
  menu: 'Ver as oportunidades ativas (MENU)',
  atendente: 'Falar com a coordenação (ATENDENTE)',
  nao_resolvido: 'Dúvida não resolvida automaticamente',
};

// Só intenções que representam uma dúvida entram no ranking (ENTRAR/SAIR não).
const QUESTION_INTENTS = ['faq_oportunidade', 'menu', 'atendente', 'nao_resolvido'];

// RF-38, RF-39 — respostas recebidas pelo chatbot, dúvidas mais frequentes
// (a partir das intenções identificadas) e taxa de resposta por oportunidade
// (contatos que perguntaram sobre ela ÷ contatos que receberam o disparo).
async function getChatbotMetrics(filters) {
  const { conditions, params } = buildMessageFilters(filters);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows: totalRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM chatbot_messages cm ${where}`,
    params
  );

  const { rows: intentRows } = await pool.query(
    `SELECT cm.intent, o.title AS opportunity_title, COUNT(*)::int AS count
     FROM chatbot_messages cm
     LEFT JOIN opportunities o ON o.id = cm.opportunity_id
     ${where}
     GROUP BY cm.intent, o.title
     ORDER BY count DESC`,
    params
  );
  const topQuestions = intentRows
    .filter((r) => QUESTION_INTENTS.includes(r.intent))
    .map((r) => ({
      question:
        r.intent === 'faq_oportunidade'
          ? `Informações sobre "${r.opportunity_title}"`
          : INTENT_LABEL[r.intent] || r.intent,
      intent: r.intent,
      count: r.count,
    }))
    .slice(0, 5);

  const dispatchFilter = buildFilters(filters);
  const dispatchWhere = dispatchFilter.conditions.length ? `AND ${dispatchFilter.conditions.join(' AND ')}` : '';
  const offset = dispatchFilter.params.length;
  const msgConditions = conditions.map((c) => c.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`));
  const msgWhere = msgConditions.length ? `AND ${msgConditions.join(' AND ')}` : '';
  const { rows: engagementRows } = await pool.query(
    `SELECT o.id, o.title,
            COUNT(DISTINCT dl.contact_id)::int AS reached,
            COUNT(DISTINCT cm.contact_id)::int AS responded
     FROM opportunities o
     JOIN dispatch_logs dl ON dl.opportunity_id = o.id AND dl.status = 'enviado' ${dispatchWhere}
     LEFT JOIN chatbot_messages cm ON cm.opportunity_id = o.id AND cm.contact_id = dl.contact_id ${msgWhere}
     GROUP BY o.id, o.title`,
    [...dispatchFilter.params, ...params]
  );
  const topEngagement = engagementRows
    .map((r) => ({
      opportunityId: r.id,
      name: r.title,
      reached: r.reached,
      responded: r.responded,
      percent: r.reached > 0 ? Math.round((r.responded / r.reached) * 100) : 0,
    }))
    .sort((a, b) => b.percent - a.percent || b.responded - a.responded)
    .slice(0, 5);

  return { responsesReceived: totalRows[0].count, topQuestions, topEngagement };
}

// Respostas recebidas por semana, para sobrepor no gráfico de envios (RF-38).
async function getWeeklyResponses(filters) {
  const { conditions, params } = buildMessageFilters(filters);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT date_trunc('week', cm.created_at)::date AS week, COUNT(*)::int AS count
     FROM chatbot_messages cm ${where}
     GROUP BY week`,
    params
  );
  return new Map(rows.map((r) => [r.week.toISOString().slice(0, 10), r.count]));
}

// RF-37 — métricas de envio, recortáveis por oportunidade e por período
// (Tela 06), a partir dos dados reais de disparo (dispatch_logs).
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

// RF-37 a RF-39 — painel de métricas consolidado (Tela 06).
async function getOverview(req, res, next) {
  try {
    const { opportunityId, from, to } = req.query;
    const filters = { opportunityId, from, to };
    const [dispatch, weeklySeries, chatbot, weeklyResponses] = await Promise.all([
      getDispatchMetrics(filters),
      getWeeklySeries(filters),
      getChatbotMetrics(filters),
      getWeeklyResponses(filters),
    ]);

    // Semanas só com respostas (sem envio) também aparecem no gráfico.
    const byWeek = new Map(weeklySeries.map((w) => [w.week, { ...w, respostas: 0 }]));
    for (const [week, count] of weeklyResponses) {
      if (!byWeek.has(week)) byWeek.set(week, { week, enviado: 0, falha: 0, pendente: 0, respostas: 0 });
      byWeek.get(week).respostas = count;
    }
    const series = [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));

    return res.json({ dispatch, weeklySeries: series, chatbot });
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
