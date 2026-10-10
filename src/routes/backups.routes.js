const express = require('express');
const { getStatus, runNow } = require('../controllers/backups.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Segurança da informação: o backup copia o banco inteiro, de todas as
// escolas — só o Administrador da plataforma vê e aciona (o Administrador de
// uma escola não pode ter acesso aos dados das outras).
router.use(requireAuth, requireRole('super_admin'));

router.get('/', getStatus);
router.post('/run', runNow);

module.exports = router;
