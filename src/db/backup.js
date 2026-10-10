// Executado direto (npm run backup): carrega o .env antes de ler as
// variáveis abaixo, senão BACKUP_DIR/PG_DUMP_PATH do .env seriam ignorados.
if (require.main === module) require('dotenv').config();

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups'));
const RETENTION_COUNT = Number(process.env.BACKUP_RETENTION_COUNT) || 7;
const PG_DUMP_PATH = process.env.PG_DUMP_PATH || 'pg_dump';

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// pg_dump lê a senha da variável PGPASSWORD do processo filho — nunca em
// argv, onde ficaria visível em listagens de processo (ps, Gerenciador de
// Tarefas).
function buildDumpArgs() {
  const args = ['--no-owner', '--no-privileges', '--format=plain'];
  const env = { ...process.env };

  if (process.env.DATABASE_URL) {
    args.push(process.env.DATABASE_URL);
  } else {
    args.push('-h', process.env.PGHOST || 'localhost');
    args.push('-p', String(process.env.PGPORT || 5432));
    args.push('-U', process.env.PGUSER || 'postgres');
    args.push('-d', process.env.PGDATABASE || 'postgres');
    env.PGPASSWORD = process.env.PGPASSWORD || '';
  }

  return { args, env };
}

async function pruneOldBackups() {
  const files = (await fs.promises.readdir(BACKUP_DIR))
    .filter((name) => name.startsWith('edubot-') && name.endsWith('.sql.gz'))
    .sort()
    .reverse();

  const toDelete = files.slice(RETENTION_COUNT);
  await Promise.all(toDelete.map((name) => fs.promises.unlink(path.join(BACKUP_DIR, name))));
  return toDelete.length;
}

async function createDump() {
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });

  const fileName = `edubot-${timestamp()}.sql.gz`;
  const filePath = path.join(BACKUP_DIR, fileName);
  const { args, env } = buildDumpArgs();

  // Só considera o backup pronto quando o pg_dump terminou com sucesso E o
  // arquivo foi gravado por inteiro; em qualquer falha o arquivo parcial é
  // apagado, para não ocupar uma vaga da retenção com um dump corrompido.
  try {
    await new Promise((resolve, reject) => {
      const dump = spawn(PG_DUMP_PATH, args, { env });
      const gzip = zlib.createGzip();
      const out = fs.createWriteStream(filePath);
      let stderr = '';
      let dumpOk = false;
      let fileOk = false;
      const done = () => dumpOk && fileOk && resolve();

      dump.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      dump.on('error', (err) => {
        if (err.code === 'ENOENT') {
          reject(new Error(`pg_dump não encontrado no servidor (${PG_DUMP_PATH}). Instale o cliente do Postgres ou ajuste PG_DUMP_PATH.`));
          return;
        }
        reject(err);
      });
      dump.stdout.pipe(gzip).pipe(out);

      out.on('error', reject);
      out.on('finish', () => {
        fileOk = true;
        done();
      });

      dump.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`pg_dump saiu com código ${code}: ${stderr.trim()}`));
          return;
        }
        dumpOk = true;
        done();
      });
    });
  } catch (err) {
    await fs.promises.unlink(filePath).catch(() => {});
    throw err;
  }

  const { size } = await fs.promises.stat(filePath);
  const removed = await pruneOldBackups();
  return { fileName, filePath, size, removed };
}

// Registra cada execução em backup_runs (só metadados) para a tela
// "Segurança · Backups". O pool é carregado aqui dentro para que o .env já
// esteja lido quando o script roda sozinho.
async function recordRun(run) {
  try {
    const pool = require('./pool');
    await pool.query(
      `INSERT INTO backup_runs (status, trigger_type, file_name, size_bytes, removed_count, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [run.status, run.trigger, run.fileName || null, run.size ?? null, run.removed || 0, run.detail || null]
    );
  } catch (err) {
    console.error('[backup] não foi possível registrar a execução:', err.message);
  }
}

let running = false;

async function runBackup({ trigger = 'automatico' } = {}) {
  if (running) {
    throw Object.assign(new Error('Já existe um backup em andamento.'), { status: 409 });
  }
  running = true;
  try {
    const result = await createDump();
    await recordRun({ status: 'sucesso', trigger, ...result });
    return result;
  } catch (err) {
    await recordRun({ status: 'falha', trigger, detail: err.message });
    throw err;
  } finally {
    running = false;
  }
}

if (require.main === module) {
  runBackup({ trigger: 'manual' })
    .then(({ filePath, removed }) => {
      console.log(`[backup] backup salvo em ${filePath} (removidos ${removed} backup(s) antigo(s))`);
    })
    .catch((err) => {
      console.error('[backup] falhou:', err.message);
      process.exitCode = 1;
    })
    .finally(() => require('./pool').end());
}

module.exports = { runBackup, BACKUP_DIR, RETENTION_COUNT };
