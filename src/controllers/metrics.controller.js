const pool = require('../db/pool');

// Multi-escola — dispatch_logs e chat_interactions não têm coluna própria
// de school_id (ver migration 009): o isolamento vem de JOIN com
// opportunities e contacts, que já pertencem a uma escola.

// RF-12 — métricas de envio, com rastreabilidade total, só da escola do
// usuário logado.
async function getDispatchMetrics(schoolId) {
  const { rows } = await pool.query(
    `SELECT dl.status, COUNT(*)::int AS count
     FROM dispatch_logs dl
     JOIN opportunities o ON o.id = dl.opportunity_id
     WHERE o.school_id = $1
     GROUP BY dl.status`,
    [schoolId]
  );
  const byStatus = { pendente: 0, enviado: 0, falha: 0 };
  rows.forEach((r) => {
    byStatus[r.status] = r.count;
  });

  const totalSent = byStatus.pendente + byStatus.enviado + byStatus.falha;

  const { rows: reachedRows } = await pool.query(
    `SELECT COUNT(DISTINCT dl.contact_id)::int AS count
     FROM dispatch_logs dl
     JOIN opportunities o ON o.id = dl.opportunity_id
     WHERE o.school_id = $1 AND dl.status = 'enviado'`,
    [schoolId]
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

// RF-13 — métricas de interação: dúvidas mais frequentes, taxa de
// respostas recebidas e oportunidades com maior engajamento, só da escola
// do usuário logado.
async function getInteractionMetrics(schoolId) {
  const { rows: intentRows } = await pool.query(
    `SELECT ci.intent, COUNT(*)::int AS count
     FROM chat_interactions ci
     JOIN contacts c ON c.id = ci.contact_id
     WHERE c.school_id = $1
     GROUP BY ci.intent`,
    [schoolId]
  );
  const byIntent = {};
  intentRows.forEach((r) => {
    byIntent[r.intent] = r.count;
  });
  const faqResolved = byIntent.faq_match || 0;
  const escalated = byIntent.escalated || 0;
  const totalQuestions = faqResolved + escalated;

  const { rows: respondersRows } = await pool.query(
    `SELECT COUNT(DISTINCT ci.contact_id)::int AS count
     FROM chat_interactions ci
     JOIN contacts c ON c.id = ci.contact_id
     WHERE c.school_id = $1 AND ci.intent NOT IN ('blocked_no_optin')`,
    [schoolId]
  );
  const { rows: reachedRows } = await pool.query(
    `SELECT COUNT(DISTINCT dl.contact_id)::int AS count
     FROM dispatch_logs dl
     JOIN opportunities o ON o.id = dl.opportunity_id
     WHERE o.school_id = $1 AND dl.status = 'enviado'`,
    [schoolId]
  );
  const contactsReached = reachedRows[0].count;
  const respondersCount = respondersRows[0].count;

  const { rows: frequentQuestions } = await pool.query(
    `SELECT lower(trim(ci.message)) AS message, COUNT(*)::int AS count
     FROM chat_interactions ci
     JOIN contacts c ON c.id = ci.contact_id
     WHERE c.school_id = $1 AND ci.intent IN ('faq_match', 'escalated')
     GROUP BY lower(trim(ci.message))
     ORDER BY count DESC
     LIMIT 5`,
    [schoolId]
  );

  const { rows: engagementRows } = await pool.query(
    `SELECT
       o.id,
       o.title,
       COUNT(DISTINCT dl.contact_id) FILTER (WHERE dl.status = 'enviado') AS sent_to,
       COUNT(DISTINCT ci.contact_id) AS asked_about
     FROM opportunities o
     LEFT JOIN dispatch_logs dl ON dl.opportunity_id = o.id
     LEFT JOIN chat_interactions ci ON ci.opportunity_id = o.id AND ci.intent = 'faq_match'
     WHERE o.school_id = $1 AND o.dispatched_at IS NOT NULL
     GROUP BY o.id, o.title
     ORDER BY asked_about DESC, sent_to DESC
     LIMIT 5`,
    [schoolId]
  );

  return {
    totalInteractions: Object.values(byIntent).reduce((a, b) => a + b, 0),
    faqResolved,
    escalated,
    automationRate: totalQuestions > 0 ? Math.round((faqResolved / totalQuestions) * 100) : 0,
    responseRate: contactsReached > 0 ? Math.round((respondersCount / contactsReached) * 100) : 0,
    topFrequentQuestions: frequentQuestions.map((r) => ({ message: r.message, count: r.count })),
    topEngagementOpportunities: engagementRows.map((r) => ({
      id: r.id,
      title: r.title,
      sentTo: Number(r.sent_to),
      askedAbout: Number(r.asked_about),
      engagementRate: Number(r.sent_to) > 0 ? Math.round((Number(r.asked_about) / Number(r.sent_to)) * 100) : 0,
    })),
  };
}

// RF-12, RF-13 — painel de métricas consolidado (Módulo E).
async function getOverview(req, res, next) {
  try {
    const [dispatch, chatbot] = await Promise.all([
      getDispatchMetrics(req.user.schoolId),
      getInteractionMetrics(req.user.schoolId),
    ]);
    return res.json({ dispatch, chatbot });
  } catch (err) {
    return next(err);
  }
}

// RF-12 — status de entrega de cada notificação, através de todas as
// oportunidades da escola do usuário logado (rastreabilidade total, RNF-07).
async function listAllDispatchLogs(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT dl.id, dl.status, dl.detail, dl.created_at, dl.updated_at,
              o.id AS opportunity_id, o.title AS opportunity_title,
              c.id AS contact_id, c.name AS contact_name, c.phone AS contact_phone
       FROM dispatch_logs dl
       JOIN opportunities o ON o.id = dl.opportunity_id
       JOIN contacts c ON c.id = dl.contact_id
       WHERE o.school_id = $1
       ORDER BY dl.created_at DESC
       LIMIT 200`,
      [req.user.schoolId]
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
