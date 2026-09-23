const express = require('express');
const multer = require('multer');
const { create, list, getById, update, dispatch, listDispatchLogs } = require('../controllers/opportunities.controller');
const attachments = require('../controllers/opportunityAttachments.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

// Anexo da oportunidade (RF-01): PDF, PNG ou JPG de até 5 MB.
const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return cb(new Error('Envie um arquivo PDF, PNG ou JPG.'));
    }
    return cb(null, true);
  },
});

function uploadAttachment(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'O anexo deve ter no máximo 5 MB.' });
    if (err) return res.status(400).json({ error: err.message || 'Falha no upload do anexo.' });
    return next();
  });
}

const router = express.Router();

router.use(requireAuth, requireRole('administrador', 'equipe_escola'));

// Leitura: Administrador e Equipe da Escola.
router.get('/', list);
router.get('/:id', getById);
router.get('/:id/dispatch-logs', listDispatchLogs);
router.get('/:id/attachment', attachments.download);

// Cadastro/edição/disparo: restrito ao Administrador (RF-20 — Equipe da
// Escola não acessa ações de gestão, apenas consulta).
router.post('/', requireRole('administrador'), create);
router.put('/:id', requireRole('administrador'), update);
router.patch('/:id/dispatch', requireRole('administrador'), dispatch);
router.put('/:id/attachment', requireRole('administrador'), uploadAttachment, attachments.upload);
router.delete('/:id/attachment', requireRole('administrador'), attachments.remove);

module.exports = router;
