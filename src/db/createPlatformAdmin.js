// Cria o Administrador da plataforma (perfil super_admin, sem escola) num
// banco que já rodou as migrations do multi-escola (013) — o caso da
// produção, onde o seed não pode rodar: ele redefine a senha das contas da
// escola. Só cria; nunca altera uma conta que já existe.
//
//   npm run admin:plataforma -- <email> "<Nome>"
//
// A senha é pedida no terminal, sem eco, e não passa pelo .env nem pelo
// histórico do shell. O banco é o do .env (DATABASE_URL ou PG*): o script
// mostra o host e pede confirmação antes de gravar.
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const pool = require('./pool');

const MIN_PASSWORD_LENGTH = 8;

function targetHost() {
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      return `${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`;
    } catch {
      return '(DATABASE_URL inválida)';
    }
  }
  return `${process.env.PGHOST}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE}`;
}

// Uma interface só para todas as perguntas: abrir uma nova a cada pergunta
// perde o que já chegou no stdin.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let muted = false;
rl._writeToOutput = (text) => {
  // Com a senha sendo digitada, nada do que entra aparece no terminal.
  if (!muted) rl.output.write(text);
};

// As linhas ficam numa fila: com a entrada redirecionada, elas chegam antes
// das perguntas (que esperam as consultas ao banco).
const lines = [];
let waiting = null;
let closed = false;
rl.on('line', (line) => {
  if (waiting) {
    const resolve = waiting;
    waiting = null;
    resolve(line);
  } else {
    lines.push(line);
  }
});
rl.on('close', () => {
  closed = true;
  if (waiting) waiting(null);
});

function ask(question, { hidden = false } = {}) {
  rl.output.write(question);
  muted = hidden;
  return new Promise((resolve) => {
    const done = (answer) => {
      muted = false;
      if (hidden) rl.output.write('\n');
      if (answer === null) return resolve('');
      resolve(answer);
    };
    if (lines.length) return done(lines.shift());
    if (closed) return done(null);
    waiting = done;
  });
}

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const name = String(process.argv[3] || 'Administrador da Plataforma').trim();
  if (!email.includes('@')) {
    throw new Error('Uso: npm run admin:plataforma -- <email> "<Nome>"');
  }

  const { rows: schools } = await pool.query("SELECT to_regclass('public.schools') AS t");
  if (!schools[0].t) {
    throw new Error('Tabela schools não encontrada — rode npm run migrate (013_multi_escola) antes.');
  }

  const { rows: existing } = await pool.query('SELECT role FROM users WHERE email = $1', [email]);
  if (existing[0]) {
    if (existing[0].role === 'super_admin') {
      console.log(`${email} já é Administrador da plataforma — nada a fazer.`);
      return;
    }
    throw new Error(`${email} já existe como ${existing[0].role}. Use outro e-mail: o script não converte contas de escola.`);
  }

  console.log(`Banco: ${targetHost()}`);
  console.log(`Conta: ${name} <${email}> · perfil super_admin`);
  const confirm = await ask('Criar neste banco? (s/N) ');
  if (confirm.trim().toLowerCase() !== 's') {
    console.log('Cancelado.');
    return;
  }

  const password = await ask('Senha (mín. 8 caracteres): ', { hidden: true });
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`A senha deve ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if ((await ask('Repita a senha: ', { hidden: true })) !== password) {
    throw new Error('As senhas não conferem.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, school_id)
     VALUES ($1, $2, $3, 'super_admin', NULL)`,
    [name, email, passwordHash]
  );
  console.log(`Administrador da plataforma criado: ${email}`);
}

main()
  .catch((err) => {
    console.error(`Falha: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
    pool.end();
  });
