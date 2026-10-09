const express = require('express');
const { listSupportRequests, updateSupportRequest } = require('../controllers/whatsapp.controller');
const { requireAuth, requireRole, requireSchool } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('administrador', 'equipe_escola'), requireSchool);

// RF-09 — fila de solicitações encaminhadas para atendimento humano.
router.get('/', listSupportRequests);
router.patch('/:id', updateSupportRequest);

module.exports = router;
