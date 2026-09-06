const express = require('express');
const { list, summary, syncStatus, triggerSync } = require('../controllers/students.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('administrador', 'equipe_escola'));

router.get('/', list);
router.get('/summary', summary);
router.get('/sync-status', syncStatus);
router.post('/sync', requireRole('administrador'), triggerSync);

module.exports = router;
