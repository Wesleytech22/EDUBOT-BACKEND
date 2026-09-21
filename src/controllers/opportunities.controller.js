const pool = require('../db/pool');
const { classifyStatus } = require('../utils/classifyStatus');
const { triggerBroadcastWorkflow, buildBroadcastMessage } = require('../utils/n8n');

function serialize(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    targetAudience: row.target_audience,
    deadline: row.deadline,
    link: row.link,
    attachmentName: row.attachment_name,
    isDraft: row.is_draft,
    dispatchedAt: row.dispatched_at,
    status: classifyStatus(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validatePayload(body, { partial = false } = {}) {
  const required = ['title', 'description', 'targetAudience', 'deadline'];
  if (!partial) {
    for (const field of required) {
      if (!body[field] || String(body[field]).trim() === '') {
        return `Campo obrigatório ausente: ${field}.`;
      }
    }
  }
  if (body.deadline && Number.isNaN(Date.parse(body.deadline))) {
    return 'Prazo de inscrição inválido.';
  }
  return null;
}

// RF-01 — cadastro unificado / RF-30 do mockup — validação dupla (front + back)
async function create(req, res, next) {
  try {
    const error = validatePayload(req.body);
    if (error) return res.status(400).json({ error });

    const { title, description, targetAudience, deadline, link, attachmentName, isDraft } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO opportunities
        (title, description, target_audience, deadline, link, attachment_name, is_draft, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [title, description, targetAudience, deadline, link || null, attachmentName || null, Boolean(isDraft), req.user.sub]
    );

    return res.status(201).json(serialize(rows[0]));
  } catch (err) {
    return next(err);
  }
}

// RF-03 — listagem com busca por título e filtros de situação/público-alvo
async function list(req, res, next) {
  try {
    const { search, status, targetAudience } = req.query;
    const { rows } = await pool.query('SELECT * FROM opportunities ORDER BY created_at DESC');

    let items = rows.map(serialize);

    if (search) {
      const term = search.toLowerCase();
      items = items.filter((o) => o.title.toLowerCase().includes(term));
    }
    if (status && status !== 'Todas') {
      items = items.filter((o) => o.status === status);
    }
    if (targetAudience && targetAudience !== 'Todos') {
      items = items.filter((o) => o.targetAudience === targetAudience);
    }

    return res.json({ items, total: items.length });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM opportunities WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Oportunidade não encontrada.' });
    return res.json(serialize(rows[0]));
  } catch (err) {
    return next(err);
  }
}

// RF-02 — edição e encerramento de oportunidades já cadastradas
async function update(req, res, next) {
  try {
    const error = validatePayload(req.body, { partial: true });
    if (error) return res.status(400).json({ error });

    const { rows: existingRows } = await pool.query('SELECT * FROM opportunities WHERE id = $1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Oportunidade não encontrada.' });

    const current = existingRows[0];
    const {
      title = current.title,
      description = current.description,
      targetAudience = current.target_audience,
      deadline = current.deadline,
      link = current.link,
      attachmentName = current.attachment_name,
      isDraft = current.is_draft,
    } = req.body;

    const { rows } = await pool.query(
      `UPDATE opportunities SET
        title = $1, description = $2, target_audience = $3, deadline = $4,
        link = $5, attachment_name = $6, is_draft = $7, updated_at = now()
       WHERE id = $8
       RETURNING *`,
      [title, description, targetAudience, deadline, link, attachmentName, isDraft, req.params.id]
    );

    return res.json(serialize(rows[0]));
  } catch (err) {
    return next(err);
  }
}

// RF-04, RF-05 — dispara o broadcast para todos os contatos com opt-in
// ativo, acionado diretamente do painel, sem edição manual da mensagem.
// O envio efetivo é responsabilidade do workflow do N8N/WAHA; aqui o
// backend só aciona o webhook e prepara o log (RF-06), que é atualizado de
// forma assíncrona pelo callback em POST /api/webhooks/n8n/dispatch-status.
async function dispatch(req, res, next) {
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM opportunities WHERE id = $1', [req.params.id]);
    const current = existingRows[0];
    if (!current) return res.status(404).json({ error: 'Oportunidade não encontrada.' });
    if (current.is_draft) return res.status(400).json({ error: 'Não é possível disparar um rascunho.' });
    if (current.dispatched_at) return res.status(400).json({ error: 'O disparo não pode ser cancelado nem repetido depois de iniciado.' });

    const { rows: contacts } = await pool.query('SELECT * FROM contacts WHERE opt_in = true');
    if (contacts.length === 0) {
      return res.status(400).json({ error: 'Nenhum contato com opt-in ativo para receber o disparo.' });
    }

    const { rows } = await pool.query(
      `UPDATE opportunities SET is_draft = false, dispatched_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    const opportunity = serialize(rows[0]);

    const { rows: logRows } = await pool.query(
      `INSERT INTO dispatch_logs (opportunity_id, contact_id, status)
       SELECT $1, id, 'pendente' FROM contacts WHERE opt_in = true
       RETURNING *`,
      [req.params.id]
    );

    const logIdByContactId = new Map(logRows.map((l) => [l.contact_id, l.id]));

    const callbackUrl = `${req.protocol}://${req.get('host')}/api/webhooks/n8n/dispatch-status`;
    const result = await triggerBroadcastWorkflow({
      opportunity,
      contacts: contacts.map((c) => ({
        logId: logIdByContactId.get(c.id),
        phone: c.phone,
        name: c.name,
      })),
      message: buildBroadcastMessage(opportunity),
      callbackUrl,
    });

    // Sem N8N acessível (dev/CI), os logs seguem marcados de imediato — em
    // produção o callback do workflow é quem resolve 'pendente' (RF-06).
    if (!result.ok) {
      await pool.query(
        `UPDATE dispatch_logs SET status = 'falha', detail = $1, updated_at = now()
         WHERE id = ANY($2::int[])`,
        [result.error, logRows.map((l) => l.id)]
      );
    }

    await pool.query(
      'INSERT INTO logs (type, user_id, opportunity_id, detail) VALUES ($1,$2,$3,$4)',
      [
        'disparo',
        req.user.sub,
        req.params.id,
        result.ok
          ? `Broadcast acionado no N8N para ${contacts.length} contato(s).`
          : `Broadcast acionado, mas o N8N não confirmou o recebimento: ${result.error}`,
      ]
    );

    return res.json({ ...opportunity, dispatchLogsCreated: logRows.length, n8n: result });
  } catch (err) {
    return next(err);
  }
}

// RF-06 — consulta do log de envio (destinatário, oportunidade, data/hora e
// status de entrega) de uma oportunidade já disparada.
async function listDispatchLogs(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT dl.id, dl.status, dl.detail, dl.created_at, dl.updated_at,
              c.id AS contact_id, c.name AS contact_name, c.phone AS contact_phone
       FROM dispatch_logs dl
       JOIN contacts c ON c.id = dl.contact_id
       WHERE dl.opportunity_id = $1
       ORDER BY dl.created_at ASC`,
      [req.params.id]
    );

    return res.json({
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        detail: row.detail,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        contact: { id: row.contact_id, name: row.contact_name, phone: row.contact_phone },
      })),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list, getById, update, dispatch, listDispatchLogs };
