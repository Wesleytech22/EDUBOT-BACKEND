const express = require('express');
const { getStatus, runNow } = require('../controllers/backups.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Segurança da informação: só o Administrador vê e aciona os backups.
router.use(requireAuth, requireRole('administrador'));

router.get('/', getStatus);
router.post('/run', runNow);

module.exports = router;
