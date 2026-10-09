const express = require('express');
const { reportDispatchStatus } = require('../controllers/webhooks.controller');
const { handleInboundMessage } = require('../controllers/whatsapp.controller');
const { requireWebhookSecret } = require('../middleware/webhookAuth');

const router = express.Router();

// Chamado pelo workflow do N8N (não por um usuário logado) — autenticado
// por segredo compartilhado, não por JWT (RF-06).
router.post('/n8n/dispatch-status', requireWebhookSecret, reportDispatchStatus);

// RF-07 a RF-11 — mensagem recebida no WhatsApp, relayada pelo N8N/WAHA.
// Multi-escola: cada escola configura no próprio N8N a URL com o identificador
// dela; sem identificador, só vale enquanto houver uma única escola.
router.post('/whatsapp/inbound', requireWebhookSecret, handleInboundMessage);
router.post('/whatsapp/inbound/:schoolSlug', requireWebhookSecret, handleInboundMessage);

module.exports = router;
