const express = require('express');
const schools = require('../controllers/schools.controller');
const { requireAuth, requireRole, requireSchool } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Escola aberta no momento — qualquer perfil, dentro da própria escola.
router.get('/current', requireRole('administrador', 'equipe_escola'), requireSchool, schools.current);

// Cadastro de escolas e contas: só o Administrador da plataforma.
router.use(requireRole('super_admin'));
router.get('/', schools.list);
router.post('/', schools.create);
router.patch('/:id', schools.update);
router.get('/:id/users', schools.listUsers);
router.post('/:id/users', schools.createUser);
router.patch('/:id/users/:userId', schools.updateUser);

module.exports = router;
