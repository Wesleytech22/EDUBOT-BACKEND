const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { signToken } = require('../utils/jwt');

// RF-20 — autenticação restrita à equipe da escola (Administrador / Equipe da Escola)
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Informe e-mail institucional e senha.' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const token = signToken(user);

    // RF-21 — registro de log de cada acesso
    await pool.query(
      'INSERT INTO logs (type, user_id, detail) VALUES ($1, $2, $3)',
      ['acesso', user.id, `Login realizado por ${user.email}`]
    );

    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, schoolId: user.school_id },
    });
  } catch (err) {
    return next(err);
  }
}

async function me(req, res) {
  return res.json({ user: req.user });
}

module.exports = { login, me };
