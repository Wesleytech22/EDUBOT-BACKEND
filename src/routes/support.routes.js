const express = require('express');
const { listSupportRequests } = require('../controllers/whatsapp.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('administrador', 'equipe_escola'));

// RF-09 — fila de solicitações encaminhadas para atendimento humano.
router.get('/', listSupportRequests);

module.exports = router;
