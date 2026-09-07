const express = require('express');
const { create, list, getById, update, dispatch } = require('../controllers/opportunities.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('administrador', 'equipe_escola'));

// Leitura: Administrador e Equipe da Escola.
router.get('/', list);
router.get('/:id', getById);

// Cadastro/edição/disparo: restrito ao Administrador (RF-20 — Equipe da
// Escola não acessa ações de gestão, apenas consulta).
router.post('/', requireRole('administrador'), create);
router.put('/:id', requireRole('administrador'), update);
router.patch('/:id/dispatch', requireRole('administrador'), dispatch);

module.exports = router;
