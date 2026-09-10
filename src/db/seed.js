// RF-20 — restrição de negócio: sem rota de sign-up público.
// Contas de acesso são criadas exclusivamente pelo Administrador via seed,
// para proteger dados escolares (ver Documento de Escopo, seção 5.7).
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function upsertUser({ name, email, password, role }) {
  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    [name, email, passwordHash, role]
  );
  console.log(`Usuário pronto: ${email} (${role})`);
}

// Tela "Sobre Nós" — créditos da equipe (Universidade Cruzeiro do Sul,
// curso de Análise e Desenvolvimento de Sistemas). Não sobrescreve
// photo_data_url num reseed, para não apagar uma foto já enviada pelo admin.
const TEAM_MEMBERS = [
  {
    name: 'José Roberto Ursino da Cruz',
    role: 'Professor Orientador — Análise e Desenvolvimento de Sistemas',
    bio: 'Docente da Universidade Cruzeiro do Sul responsável pela disciplina. Acompanha as sprints e cobra rigor de escopo antes que a equipe cobre de si mesma.',
    displayOrder: 0,
  },
  {
    name: 'Wesley Rodrigues Dias',
    role: 'Scrum Master / Desenvolvedor Fullstack',
    bio: 'Cursando Análise e Desenvolvimento de Sistemas. Conduz as sprints e escreve o código ao mesmo tempo — acredita que a melhor forma de estimar uma tarefa é já ter começado ela.',
    displayOrder: 1,
  },
  {
    name: 'Luana Aparecida Silva Che',
    role: 'Product Owner',
    bio: 'Cursando Análise e Desenvolvimento de Sistemas. Traduz o que a escola precisa em requisito, prioriza o backlog e ainda encontra tempo pra revisar arquitetura com o time.',
    displayOrder: 2,
  },
  {
    name: 'Leonardo Oliveira Rocha',
    role: 'Desenvolvedor Frontend',
    bio: 'Cursando Análise e Desenvolvimento de Sistemas. Transforma o design do Figma em componentes React reutilizáveis, sem perder um pixel no caminho.',
    displayOrder: 3,
  },
  {
    name: 'Clayton de Andrade Junior',
    role: 'Desenvolvedor Frontend',
    bio: 'Cursando Análise e Desenvolvimento de Sistemas. Não descansa enquanto o pixel não bate com o Figma — e o console não fica limpo de warnings.',
    displayOrder: 4,
  },
  {
    name: 'Nicolas Neris dos Santos Dourado',
    role: 'QA',
    bio: 'Cursando Análise e Desenvolvimento de Sistemas. Encontra o bug que ninguém mais reproduziu, e depois escreve o teste pra ele nunca mais voltar.',
    displayOrder: 5,
  },
  {
    name: 'Gabriel Yanes',
    role: 'Desenvolvedor Backend',
    bio: 'Cursando Análise e Desenvolvimento de Sistemas. Prefere resolver o problema na modelagem do banco antes que ele vire bug em produção.',
    displayOrder: 6,
  },
];

async function upsertTeamMember({ name, role, bio, displayOrder }) {
  await pool.query(
    `INSERT INTO team_members (name, role, bio, display_order)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET role = EXCLUDED.role, bio = EXCLUDED.bio, display_order = EXCLUDED.display_order, updated_at = now()`,
    [name, role, bio, displayOrder]
  );
  console.log(`Membro da equipe pronto: ${name} (${role})`);
}

async function seed() {
  await upsertUser({
    name: 'Coordenação Pedagógica',
    email: process.env.SEED_ADMIN_EMAIL || 'coordenacao@escola.edu.br',
    password: process.env.SEED_ADMIN_PASSWORD || 'EduBot@2026',
    role: 'administrador',
  });

  await upsertUser({
    name: 'Equipe da Escola',
    email: process.env.SEED_EQUIPE_EMAIL || 'equipe@escola.edu.br',
    password: process.env.SEED_EQUIPE_PASSWORD || 'EduBot@2026',
    role: 'equipe_escola',
  });

  for (const member of TEAM_MEMBERS) {
    await upsertTeamMember(member);
  }

  // Cauê Soares Valente saiu do time — remove o card da tela "Sobre Nós".
  await pool.query('DELETE FROM team_members WHERE name = $1', ['Cauê Soares Valente']);

  await pool.end();
}

seed().catch((err) => {
  console.error('Falha ao popular usuários:', err);
  process.exit(1);
});
