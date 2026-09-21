const pool = require('../db/pool');

// RF-06 — callback chamado pelo workflow do N8N/WAHA para reportar, contato
// a contato, o status de entrega de um disparo já iniciado.
async function reportDispatchStatus(req, res, next) {
  try {
    const { logId, status, detail } = req.body;

    if (!logId || !['enviado', 'falha'].includes(status)) {
      return res.status(400).json({ error: 'Informe logId e status ("enviado" ou "falha").' });
    }

    const { rows } = await pool.query(
      `UPDATE dispatch_logs SET status = $1, detail = $2, updated_at = now()
       WHERE id = $3 RETURNING *`,
      [status, detail || null, logId]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Log de disparo não encontrado.' });

    return res.json({ id: rows[0].id, status: rows[0].status });
  } catch (err) {
    return next(err);
  }
}

module.exports = { reportDispatchStatus };
