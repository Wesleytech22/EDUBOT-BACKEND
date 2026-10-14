const express = require('express');
const multer = require('multer');
const { list, updatePhoto } = require('../controllers/team.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Envie apenas arquivos de imagem.'));
    }
    return cb(null, true);
  },
});

function uploadPhoto(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'A imagem passa de 2 MB. Escolha uma foto menor.' });
    }
    if (err) return res.status(400).json({ error: err.message || 'Falha no upload da imagem.' });
    return next();
  });
}

const router = express.Router();

router.use(requireAuth, requireRole('administrador', 'equipe_escola'));

// Leitura: Administrador e Equipe da Escola (tela "Sobre Nós").
router.get('/', list);

// Upload de foto: restrito ao Administrador da plataforma (super_admin).
// O Administrador da escola só visualiza as fotos.
router.put('/:id/photo', requireRole('super_admin'), uploadPhoto, updatePhoto);

module.exports = router;
