const express = require('express');
const multer = require('multer');
const { getSheetConfig, updateSheetConfig, uploadSheetFile, previewSheet } = require('../controllers/integrations.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// RF-15 — arquivo em memória (nunca gravado em disco), até 5 MB, suficiente
// para uma planilha escolar em CSV.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(requireAuth, requireRole('administrador', 'equipe_escola'));

router.get('/sheets/config', getSheetConfig);
router.put('/sheets/config', requireRole('administrador'), updateSheetConfig);
router.post('/sheets/upload', requireRole('administrador'), upload.single('file'), uploadSheetFile);
router.get('/sheets/preview', previewSheet);

module.exports = router;
