const express = require('express');
const { create, list, getById, update, dispatch, listDispatchLogs } = require('../controllers/opportunities.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('administrador', 'equipe_escola'));

router.get('/', list);
router.get('/:id', getById);
router.post('/', create);
router.put('/:id', update);
router.patch('/:id/dispatch', dispatch);
router.get('/:id/dispatch-logs', listDispatchLogs);

module.exports = router;
