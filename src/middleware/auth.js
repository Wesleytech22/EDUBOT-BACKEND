const pool = require('../db/pool');
const { verifyToken } = require('../utils/jwt');

// RF-20/RF-21 — bloqueia acesso sem token válido e distingue perfis.
// Uma sessão expirada (JWT_EXPIRES_IN) é tratada como "sessão inativa encerrada".
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Acesso não autorizado. Faça login novamente.' });
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  }
}

// O Administrador da plataforma (super_admin) pode tudo o que o
// Administrador de uma escola pode — dentro da escola que escolheu abrir
// (ver requireSchool).
function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.user?.role;
    const allowed = roles.includes(role) || (role === 'super_admin' && roles.includes('administrador'));
    if (!allowed) {
      return res.status(403).json({ error: 'Perfil sem permissão para este recurso.' });
    }
    return next();
  };
}

// Multi-escola — define req.schoolId para as rotas de dados de uma escola.
// Administrador e Equipe da Escola sempre usam a escola da própria conta
// (vem do token, nunca do cliente). O Administrador da plataforma escolhe
// qual escola abrir pelo cabeçalho X-School-Id.
async function requireSchool(req, res, next) {
  try {
    if (req.user.role !== 'super_admin') {
      if (!req.user.schoolId) {
        return res.status(401).json({ error: 'Sessão sem escola vinculada. Faça login novamente.' });
      }
      req.schoolId = req.user.schoolId;
      return next();
    }

    const requested = req.headers['x-school-id'];
    if (!requested) {
      return res.status(400).json({ error: 'Selecione uma escola para continuar.' });
    }
    const { rows } = await pool.query('SELECT id FROM schools WHERE id::text = $1', [String(requested)]);
    if (!rows[0]) {
      return res.status(404).json({ error: 'Escola não encontrada.' });
    }
    req.schoolId = rows[0].id;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAuth, requireRole, requireSchool };
