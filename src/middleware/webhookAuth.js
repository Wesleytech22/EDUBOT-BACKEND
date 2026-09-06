// RNF-08 — as credenciais das integrações externas (aqui, o segredo que
// autoriza o N8N a chamar o callback de status) ficam fora do código-fonte,
// em variável de ambiente.
function requireWebhookSecret(req, res, next) {
  const expected = process.env.N8N_WEBHOOK_SECRET;
  const received = req.headers['x-webhook-secret'];

  if (!expected || received !== expected) {
    return res.status(401).json({ error: 'Segredo de webhook inválido ou ausente.' });
  }
  return next();
}

module.exports = { requireWebhookSecret };
