const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { signToken } = require('../utils/jwt');
const { generateResetToken, hashResetToken } = require('../utils/resetToken');
const { sendPasswordResetEmail } = require('../utils/mailer');

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
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    return next(err);
  }
}

async function me(req, res) {
  return res.json({ user: req.user });
}

// Login - fluxo "Esqueci minha senha" (1/2): gera o token e envia por e-mail
// (SMTP real em produção via .env; ver src/utils/mailer.js).
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Informe o e-mail institucional.' });
    }

    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    const user = rows[0];

    if (user) {
      const { token, tokenHash, expiresAt } = generateResetToken();
      await pool.query(
        'UPDATE users SET reset_token_hash = $1, reset_token_expires_at = $2 WHERE id = $3',
        [tokenHash, expiresAt, user.id]
      );

      const resetLink = `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/redefinir-senha?token=${token}`;
      await sendPasswordResetEmail(email, resetLink);
    }

    // Resposta genérica independente de o e-mail existir (evita enumeração de contas).
    return res.json({ message: 'Se o e-mail existir, enviaremos as instruções de redefinição.' });
  } catch (err) {
    return next(err);
  }
}

// Login - fluxo "Esqueci minha senha" (2/2): valida o token e troca a senha.
async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Informe o token e a nova senha.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'A nova senha deve ter ao menos 8 caracteres.' });
    }

    const tokenHash = hashResetToken(token);
    const { rows } = await pool.query(
      'SELECT id FROM users WHERE reset_token_hash = $1 AND reset_token_expires_at > now()',
      [tokenHash]
    );
    const user = rows[0];

    if (!user) {
      return res.status(400).json({ error: 'Token inválido ou expirado. Solicite a redefinição novamente.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires_at = NULL WHERE id = $2',
      [passwordHash, user.id]
    );

    return res.json({ message: 'Senha redefinida com sucesso. Você já pode entrar com a nova senha.' });
  } catch (err) {
    return next(err);
  }
}

module.exports = { login, me, forgotPassword, resetPassword };
