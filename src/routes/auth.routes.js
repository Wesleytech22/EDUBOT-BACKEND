const express = require('express');
const { login, me, forgotPassword, resetPassword } = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', login);
router.get('/me', requireAuth, me);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
