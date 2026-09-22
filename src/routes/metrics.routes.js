const express = require('express');
const { getOverview, listAllDispatchLogs } = require('../controllers/metrics.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('administrador', 'equipe_escola'));

router.get('/overview', getOverview);
router.get('/dispatch-logs', listAllDispatchLogs);

module.exports = router;
