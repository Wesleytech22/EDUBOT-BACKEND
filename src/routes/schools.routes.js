const express = require('express');
const { create, list } = require('../controllers/schools.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('super_admin'));

router.get('/', list);
router.post('/', create);

module.exports = router;
