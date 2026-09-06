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

// RF-04 — contatos de exemplo para exercitar o broadcast em ambiente local.
// O cadastro real de opt-in pelo próprio WhatsApp (RF-10) chega no Módulo D,
// na Sprint 04 — até lá, esta é a única forma de povoar a lista de envio.
async function upsertContact({ schoolId, phone, name }) {
  await pool.query(
    `INSERT INTO contacts (school_id, phone, name, opt_in)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (school_id, phone) DO NOTHING`,
    [schoolId, phone, name]
  );
}

// RF-18 — alunos de exemplo para exercitar o dashboard escolar sem
// depender de uma planilha real configurada. A sincronização de verdade
// (Módulo G) sobrescreve estes registros na primeira execução bem-sucedida.
// A coordenação registra presenças/faltas (números inteiros); a
// frequência (%) é sempre calculada, nunca digitada diretamente.
async function upsertStudent({ schoolId, name, grade, present, absent, situation }) {
  const total = present + absent;
  const attendance = total === 0 ? 0 : Math.round((present / total) * 1000) / 10;

  await pool.query(
    `INSERT INTO students (school_id, name, grade, attendance, attendance_present, attendance_absent, situation, school_year, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, EXTRACT(YEAR FROM now()), now())
     ON CONFLICT (school_id, name, grade, school_year) DO NOTHING`,
    [schoolId, name, grade, attendance, present, absent, situation]
  );
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

  await upsertContact({ schoolId: defaultSchoolId, phone: '+5511999990001', name: 'Aluno de teste 1' });
  await upsertContact({ schoolId: defaultSchoolId, phone: '+5511999990002', name: 'Responsável de teste 2' });
  console.log('Contatos de teste prontos (RF-04).');

  await upsertStudent({ schoolId: defaultSchoolId, name: 'Ana Souza', grade: '9º Ano A', present: 92, absent: 8, situation: 'Regular' });
  await upsertStudent({ schoolId: defaultSchoolId, name: 'Bruno Lima', grade: '9º Ano A', present: 68, absent: 32, situation: 'Atenção' });
  await upsertStudent({ schoolId: defaultSchoolId, name: 'Carla Dias', grade: '1º Ano B', present: 45, absent: 55, situation: 'Risco' });
  console.log('Alunos de teste prontos (RF-18).');

  await pool.end();
}

seed().catch((err) => {
  console.error('Falha ao popular usuários:', err);
  process.exit(1);
});
