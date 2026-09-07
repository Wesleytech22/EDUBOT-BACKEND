const crypto = require('crypto');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

function generateResetToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  return { token, tokenHash, expiresAt };
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { generateResetToken, hashResetToken };
