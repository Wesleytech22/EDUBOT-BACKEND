const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { signToken } = require('../utils/jwt');
const { generateResetToken, hashResetToken } = require('../utils/resetToken');
const { sendPasswordResetEmail } = require('../utils/mailer');

// Login — proteção contra força bruta: bloqueia a conta por um tempo após
// tentativas repetidas com senha errada.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// URL do frontend usada para montar o link de redefinição de senha.
// É separada de CORS_ORIGIN (que pode listar várias origens, separadas por
// vírgula, para liberar CORS) — sem essa separação, um CORS_ORIGIN com mais
// de uma origem gera um link quebrado. Configure FRONTEND_URL em produção;
// na ausência dela, usa a primeira origem de CORS_ORIGIN como fallback.
function getFrontendUrl() {
  const configured =
    process.env.FRONTEND_URL || (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0];
  return configured.trim().replace(/\/+$/, '');
}

function lockoutResponse(res, lockedUntil) {
  const secondsLeft = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 1000));
  res.set('Retry-After', String(secondsLeft));
  return res.status(429).json({
    error: `Muitas tentativas de login. Tente novamente em ${Math.ceil(secondsLeft / 60)} minuto(s).`,
  });
}

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

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return lockoutResponse(res, user.locked_until);
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      const attempts = user.failed_login_attempts + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
      const lockedUntil = shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;

      await pool.query(
        'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
        [shouldLock ? 0 : attempts, lockedUntil, user.id]
      );

      if (shouldLock) {
        return lockoutResponse(res, lockedUntil);
      }
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    if (user.failed_login_attempts > 0 || user.locked_until) {
      await pool.query(
        'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1',
        [user.id]
      );
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

      const resetLink = `${getFrontendUrl()}/redefinir-senha?token=${token}`;

      // Não usa await: o envio por SMTP não deve travar a resposta HTTP
      // (um SMTP lento/indisponível não pode virar timeout para o cliente).
      sendPasswordResetEmail(email, resetLink).catch((err) => {
        console.error('[forgotPassword] falha ao enviar e-mail de redefinição:', err);
      });
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
