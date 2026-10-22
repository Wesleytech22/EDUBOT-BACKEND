const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { getBotUsername } = require('../telegram/bot');

// Multi-escola — o Administrador da plataforma cadastra as escolas e as
// contas de cada uma (sem autocadastro público, como pede o RF-20: só
// acrescenta um nível acima do Administrador da escola).

const SCHOOL_ROLES = ['administrador', 'equipe_escola'];
const MIN_PASSWORD_LENGTH = 8;

function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Link de entrada no chatbot do Telegram: o mesmo bot atende todas as
// escolas, e o parâmetro start diz com qual escola o contato vai conversar.
async function telegramLinkFor(slug) {
  const username = await getBotUsername();
  return username ? `https://t.me/${username}?start=${slug}` : null;
}

async function serializeSchool(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    active: row.active,
    createdAt: row.created_at,
    telegramLink: await telegramLinkFor(row.slug),
    counts: row.users_count === undefined
      ? undefined
      : {
          users: row.users_count,
          opportunities: row.opportunities_count,
          contacts: row.contacts_count,
          students: row.students_count,
        },
  };
}

function serializeUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active, createdAt: row.created_at };
}

function validateAccount({ name, email, password, role }) {
  if (!name || !String(name).trim()) return 'Informe o nome da pessoa.';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return 'Informe um e-mail válido.';
  if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
    return `A senha inicial deve ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (role && !SCHOOL_ROLES.includes(role)) return 'Perfil inválido.';
  return null;
}

async function insertAccount(client, schoolId, { name, email, password, role }) {
  const passwordHash = await bcrypt.hash(String(password), 10);
  const { rows } = await client.query(
    `INSERT INTO users (name, email, password_hash, role, school_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [String(name).trim(), String(email).trim().toLowerCase(), passwordHash, role, schoolId]
  );
  return rows[0];
}

// Auditoria das ações do Administrador da plataforma (tabela logs).
async function audit(db, userId, detail) {
  await db.query('INSERT INTO logs (type, user_id, detail) VALUES ($1, $2, $3)', ['escola', userId, detail]);
}

function isUniqueViolation(err, constraint) {
  return err.code === '23505' && (!constraint || err.constraint === constraint);
}

async function list(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT s.*,
              (SELECT COUNT(*)::int FROM users u WHERE u.school_id = s.id) AS users_count,
              (SELECT COUNT(*)::int FROM opportunities o WHERE o.school_id = s.id) AS opportunities_count,
              (SELECT COUNT(*)::int FROM contacts c WHERE c.school_id = s.id AND c.opt_in) AS contacts_count,
              (SELECT COUNT(*)::int FROM students st WHERE st.school_id = s.id) AS students_count
       FROM schools s
       ORDER BY s.name ASC`
    );
    return res.json({ items: await Promise.all(rows.map(serializeSchool)) });
  } catch (err) {
    return next(err);
  }
}

// Cria a escola já com a primeira conta de Administrador dela, numa
// transação só — não existe escola sem ninguém para administrá-la.
async function create(req, res, next) {
  const { name, slug: rawSlug, admin = {} } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Informe o nome da escola.' });
  }
  const slug = slugify(rawSlug || name);
  if (!slug) {
    return res.status(400).json({ error: 'Não foi possível gerar o identificador da escola a partir do nome.' });
  }
  const accountError = validateAccount({ ...admin, role: 'administrador' });
  if (accountError) return res.status(400).json({ error: accountError });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING *', [
      String(name).trim(),
      slug,
    ]);
    const school = rows[0];
    const adminRow = await insertAccount(client, school.id, { ...admin, role: 'administrador' });
    await audit(client, req.user.sub, `Escola "${school.name}" cadastrada com o Administrador ${adminRow.email}`);
    await client.query('COMMIT');
    return res.status(201).json({ ...(await serializeSchool(school)), admin: serializeUser(adminRow) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(err, 'schools_slug_key')) {
      return res.status(409).json({ error: `Já existe uma escola com o identificador "${slug}".` });
    }
    if (isUniqueViolation(err, 'users_email_key')) {
      return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
    }
    return next(err);
  } finally {
    client.release();
  }
}

// Renomear ou suspender/reativar a escola (suspensa: ninguém dela entra).
async function update(req, res, next) {
  try {
    const { name, active } = req.body;
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ error: 'O nome da escola não pode ficar vazio.' });
    }
    const { rows } = await pool.query(
      `UPDATE schools SET
         name = COALESCE($1, name),
         active = COALESCE($2, active),
         updated_at = now()
       WHERE id::text = $3 RETURNING *`,
      [name === undefined ? null : String(name).trim(), typeof active === 'boolean' ? active : null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Escola não encontrada.' });
    if (typeof active === 'boolean') {
      await audit(pool, req.user.sub, `Escola "${rows[0].name}" ${active ? 'reativada' : 'suspensa'}`);
    }
    return res.json(await serializeSchool(rows[0]));
  } catch (err) {
    return next(err);
  }
}

async function findSchool(id) {
  const { rows } = await pool.query('SELECT * FROM schools WHERE id::text = $1', [String(id)]);
  return rows[0] || null;
}

async function listUsers(req, res, next) {
  try {
    if (!(await findSchool(req.params.id))) return res.status(404).json({ error: 'Escola não encontrada.' });
    const { rows } = await pool.query('SELECT * FROM users WHERE school_id::text = $1 ORDER BY role ASC, name ASC', [
      req.params.id,
    ]);
    return res.json({ items: rows.map(serializeUser) });
  } catch (err) {
    return next(err);
  }
}

async function createUser(req, res, next) {
  try {
    const school = await findSchool(req.params.id);
    if (!school) return res.status(404).json({ error: 'Escola não encontrada.' });
    const role = req.body.role || 'equipe_escola';
    const error = validateAccount({ ...req.body, role });
    if (error) return res.status(400).json({ error });

    const row = await insertAccount(pool, school.id, { ...req.body, role });
    await audit(pool, req.user.sub, `Conta ${row.email} (${role}) criada na escola "${school.name}"`);
    return res.status(201).json(serializeUser(row));
  } catch (err) {
    if (isUniqueViolation(err, 'users_email_key')) {
      return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
    }
    return next(err);
  }
}

// Ativar/desativar uma conta ou trocar o perfil dela dentro da escola.
async function updateUser(req, res, next) {
  try {
    const { active, role } = req.body;
    if (role !== undefined && !SCHOOL_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Perfil inválido.' });
    }
    const { rows } = await pool.query(
      `UPDATE users SET
         active = COALESCE($1, active),
         role = COALESCE($2, role)
       WHERE id::text = $3 AND school_id::text = $4 RETURNING *`,
      [typeof active === 'boolean' ? active : null, role || null, req.params.userId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Conta não encontrada nesta escola.' });
    await audit(
      pool,
      req.user.sub,
      `Conta ${rows[0].email} atualizada: ${rows[0].active ? 'ativa' : 'desativada'}, perfil ${rows[0].role}`
    );
    return res.json(serializeUser(rows[0]));
  } catch (err) {
    return next(err);
  }
}

// A escola aberta no momento (do usuário logado ou a escolhida pelo
// Administrador da plataforma) — nome e link do chatbot para divulgar.
async function current(req, res, next) {
  try {
    const school = await findSchool(req.schoolId);
    if (!school) return res.status(404).json({ error: 'Escola não encontrada.' });
    return res.json(await serializeSchool(school));
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, create, update, listUsers, createUser, updateUser, current, slugify };
