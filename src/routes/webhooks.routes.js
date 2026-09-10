const express = require('express');
const { reportDispatchStatus } = require('../controllers/webhooks.controller');
const { requireWebhookSecret } = require('../middleware/webhookAuth');

const router = express.Router();

// Chamado pelo workflow do N8N (não por um usuário logado) — autenticado
// por segredo compartilhado, não por JWT (RF-06).
router.post('/n8n/dispatch-status', requireWebhookSecret, reportDispatchStatus);

module.exports = router;
