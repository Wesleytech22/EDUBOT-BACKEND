const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
    userCount: row.user_count !== undefined ? Number(row.user_count) : undefined,
  };
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// RF-20 (ajuste) — só o super_admin cadastra escolas; continua sem
// autocadastro público. Cria a escola e a primeira conta de Administrador
// dela em uma única chamada, para não deixar uma escola sem ninguém para
// entrar.
async function create(req, res, next) {
  const client = await pool.connect();
  try {
    const { name, slug, adminName, adminEmail, adminPassword } = req.body;

    if (!name || !slug || !adminName || !adminEmail || !adminPassword) {
      return res
        .status(400)
        .json({ error: 'Informe nome e slug da escola, e nome/e-mail/senha do primeiro Administrador.' });
    }
    if (!SLUG_PATTERN.test(slug)) {
      return res.status(400).json({ error: 'O slug deve conter apenas letras minúsculas, números e hífen.' });
    }
    if (String(adminPassword).length < 8) {
      return res.status(400).json({ error: 'A senha do Administrador deve ter ao menos 8 caracteres.' });
    }

    await client.query('BEGIN');

    const { rows: schoolRows } = await client.query(
      'INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING *',
      [name.trim(), slug.trim().toLowerCase()]
    );
    const school = schoolRows[0];

    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await client.query(
      `INSERT INTO users (name, email, password_hash, role, school_id)
       VALUES ($1, $2, $3, 'administrador', $4)`,
      [adminName.trim(), adminEmail.trim().toLowerCase(), passwordHash, school.id]
    );

    await client.query('COMMIT');
    return res.status(201).json(serialize(school));
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Já existe uma escola com esse slug, ou um usuário com esse e-mail.' });
    }
    return next(err);
  } finally {
    client.release();
  }
}

// RF-20 (ajuste) — o super_admin acompanha quantas escolas e contas
// existem, sem entrar nos dados operacionais de cada uma.
async function list(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, COUNT(u.id) AS user_count
       FROM schools s
       LEFT JOIN users u ON u.school_id = s.id
       GROUP BY s.id
       ORDER BY s.created_at DESC`
    );
    return res.json({ items: rows.map(serialize) });
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list };
