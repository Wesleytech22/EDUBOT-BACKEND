const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

// O Render não roda as migrations no deploy: a tabela de anexos é criada na
// primeira vez que for usada, com o mesmo SQL (idempotente) da migration 009.
let tableReady = null;
function ensureAttachmentsTable() {
  if (!tableReady) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '009_opportunity_attachments.sql'), 'utf8');
    tableReady = pool.query(sql).catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

// Tipos aceitos (PDF, PNG ou JPG) conferidos também pelo conteúdo do
// arquivo, e não só pelo mimetype informado pelo navegador.
const SIGNATURES = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46], // %PDF
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

function matchesSignature(file) {
  const signature = SIGNATURES[file.mimetype];
  return Boolean(signature) && signature.every((byte, i) => file.buffer[i] === byte);
}

async function findOpportunity(id) {
  const { rows } = await pool.query('SELECT id FROM opportunities WHERE id = $1', [id]);
  return rows[0];
}

async function hasAttachment(opportunityId) {
  await ensureAttachmentsTable();
  const { rows } = await pool.query('SELECT 1 FROM opportunity_attachments WHERE opportunity_id = $1', [opportunityId]);
  return rows.length > 0;
}

// Envia (ou substitui) o anexo de uma oportunidade — Administrador.
async function upload(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie um arquivo PDF, PNG ou JPG.' });
    if (!matchesSignature(req.file)) {
      return res.status(400).json({ error: 'O conteúdo do arquivo não corresponde a um PDF, PNG ou JPG válido.' });
    }
    if (!(await findOpportunity(req.params.id))) return res.status(404).json({ error: 'Oportunidade não encontrada.' });

    await ensureAttachmentsTable();
    const fileName = path.basename(req.file.originalname).slice(0, 200);

    await pool.query(
      `INSERT INTO opportunity_attachments (opportunity_id, file_name, mime_type, size_bytes, data, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (opportunity_id) DO UPDATE SET
         file_name = EXCLUDED.file_name, mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes,
         data = EXCLUDED.data, uploaded_by = EXCLUDED.uploaded_by, created_at = now()`,
      [req.params.id, fileName, req.file.mimetype, req.file.size, req.file.buffer, req.user.sub]
    );
    await pool.query('UPDATE opportunities SET attachment_name = $1, updated_at = now() WHERE id = $2', [fileName, req.params.id]);

    return res.json({ attachmentName: fileName, hasAttachment: true, size: req.file.size, mimeType: req.file.mimetype });
  } catch (err) {
    return next(err);
  }
}

// Download do anexo — Administrador e Equipe da Escola.
async function download(req, res, next) {
  try {
    await ensureAttachmentsTable();
    const { rows } = await pool.query(
      'SELECT file_name, mime_type, data FROM opportunity_attachments WHERE opportunity_id = $1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Esta oportunidade não tem anexo enviado.' });

    const { file_name: fileName, mime_type: mimeType, data } = rows[0];
    res.set('Content-Type', mimeType);
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.set('X-Content-Type-Options', 'nosniff');
    return res.send(data);
  } catch (err) {
    return next(err);
  }
}

// Remove o anexo — Administrador.
async function remove(req, res, next) {
  try {
    if (!(await findOpportunity(req.params.id))) return res.status(404).json({ error: 'Oportunidade não encontrada.' });
    await ensureAttachmentsTable();
    await pool.query('DELETE FROM opportunity_attachments WHERE opportunity_id = $1', [req.params.id]);
    await pool.query('UPDATE opportunities SET attachment_name = NULL, updated_at = now() WHERE id = $1', [req.params.id]);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
}

module.exports = { upload, download, remove, hasAttachment, ensureAttachmentsTable };
