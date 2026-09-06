// RF-20 — restrição de negócio: sem rota de sign-up público.
// Contas de acesso são criadas exclusivamente pelo super_admin/Administrador
// via seed, para proteger dados escolares (ver Documento de Escopo, seção 5.7).
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function upsertUser({ name, email, password, role, schoolId }) {
  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, school_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       school_id = EXCLUDED.school_id`,
    [name, email, passwordHash, role, schoolId]
  );
  console.log(`Usuário pronto: ${email} (${role})`);
}

async function seed() {
  // Multi-escola — a migration já cria a "Escola Padrão" (slug
  // escola-padrao); o seed só a reaproveita para as contas de teste.
  const { rows: schoolRows } = await pool.query("SELECT id FROM schools WHERE slug = 'escola-padrao'");
  const defaultSchoolId = schoolRows[0]?.id;
  if (!defaultSchoolId) {
    throw new Error('Escola padrão não encontrada — rode "npm run migrate" antes do seed.');
  }

  await upsertUser({
    name: 'Equipe Técnica EduBot',
    email: process.env.SEED_SUPER_ADMIN_EMAIL || 'superadmin@edubot.dev',
    password: process.env.SEED_SUPER_ADMIN_PASSWORD || 'EduBot@2026',
    role: 'super_admin',
    schoolId: null,
  });

  await upsertUser({
    name: 'Coordenação Pedagógica',
    email: process.env.SEED_ADMIN_EMAIL || 'coordenacao@escola.edu.br',
    password: process.env.SEED_ADMIN_PASSWORD || 'EduBot@2026',
    role: 'administrador',
    schoolId: defaultSchoolId,
  });

  await upsertUser({
    name: 'Equipe da Escola',
    email: process.env.SEED_EQUIPE_EMAIL || 'equipe@escola.edu.br',
    password: process.env.SEED_EQUIPE_PASSWORD || 'EduBot@2026',
    role: 'equipe_escola',
    schoolId: defaultSchoolId,
  });

  await pool.end();
}

seed().catch((err) => {
  console.error('Falha ao popular usuários:', err);
  process.exit(1);
});
