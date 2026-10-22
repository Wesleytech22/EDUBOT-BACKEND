const jwt = require('jsonwebtoken');

// schoolId é a escola da conta (nulo para o Administrador da plataforma) —
// as rotas de dados de escola confiam nele, nunca em algo vindo do cliente.
function signToken(user) {
  return jwt.sign(
    { sub: user.id, name: user.name, email: user.email, role: user.role, schoolId: user.school_id || null },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30m' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { signToken, verifyToken };
