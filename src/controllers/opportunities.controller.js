const pool = require('../db/pool');
const { classifyStatus } = require('../utils/classifyStatus');

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

// Multi-escola — toda oportunidade pertence a uma única escola (a do
// usuário logado); nenhuma consulta abaixo enxerga dados de outra escola.

// RF-01 — cadastro unificado / RF-30 do mockup — validação dupla (front + back)
async function create(req, res, next) {
  try {
    const error = validatePayload(req.body);
    if (error) return res.status(400).json({ error });

    const { title, description, targetAudience, deadline, link, attachmentName, isDraft } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO opportunities
        (title, description, target_audience, deadline, link, attachment_name, is_draft, created_by, school_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        title,
        description,
        targetAudience,
        deadline,
        link || null,
        attachmentName || null,
        Boolean(isDraft),
        req.user.sub,
        req.user.schoolId,
      ]
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
    const { rows } = await pool.query(
      'SELECT * FROM opportunities WHERE school_id = $1 ORDER BY created_at DESC',
      [req.user.schoolId]
    );

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
    const { rows } = await pool.query('SELECT * FROM opportunities WHERE id = $1 AND school_id = $2', [
      req.params.id,
      req.user.schoolId,
    ]);
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

    const { rows: existingRows } = await pool.query(
      'SELECT * FROM opportunities WHERE id = $1 AND school_id = $2',
      [req.params.id, req.user.schoolId]
    );
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
       WHERE id = $8 AND school_id = $9
       RETURNING *`,
      [title, description, targetAudience, deadline, link, attachmentName, isDraft, req.params.id, req.user.schoolId]
    );

    return res.json(serialize(rows[0]));
  } catch (err) {
    return next(err);
  }
}

// RF-05 (restrito à S02, ver retro slide 9): o botão "Disparar" apenas
// altera o status/registro no banco. A orquestração do webhook para o N8N
// só é acoplada na Sprint 03 — nenhuma mensagem real é enviada aqui.
async function dispatch(req, res, next) {
  try {
    const { rows: existingRows } = await pool.query(
      'SELECT * FROM opportunities WHERE id = $1 AND school_id = $2',
      [req.params.id, req.user.schoolId]
    );
    const current = existingRows[0];
    if (!current) return res.status(404).json({ error: 'Oportunidade não encontrada.' });
    if (current.is_draft) return res.status(400).json({ error: 'Não é possível disparar um rascunho.' });
    if (current.dispatched_at) return res.status(400).json({ error: 'O disparo não pode ser cancelado nem repetido depois de iniciado.' });

    const { rows } = await pool.query(
      `UPDATE opportunities SET is_draft = false, dispatched_at = now(), updated_at = now()
       WHERE id = $1 AND school_id = $2 RETURNING *`,
      [req.params.id, req.user.schoolId]
    );

    await pool.query(
      'INSERT INTO logs (type, user_id, opportunity_id, detail) VALUES ($1,$2,$3,$4)',
      ['disparo', req.user.sub, req.params.id, 'Status de disparo atualizado no banco (RF-05 restrito à S02 — sem envio real via N8N/WAHA)']
    );

    return res.json(serialize(rows[0]));
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list, getById, update, dispatch };
