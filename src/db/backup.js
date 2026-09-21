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

async function runBackup() {
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });

  const fileName = `edubot-${timestamp()}.sql.gz`;
  const filePath = path.join(BACKUP_DIR, fileName);
  const { args, env } = buildDumpArgs();

  await new Promise((resolve, reject) => {
    const dump = spawn(PG_DUMP_PATH, args, { env });
    const gzip = zlib.createGzip();
    const out = fs.createWriteStream(filePath);
    let stderr = '';

    dump.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    dump.on('error', reject);
    dump.stdout.pipe(gzip).pipe(out);

    out.on('error', reject);
    out.on('finish', () => resolve());

    dump.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`pg_dump saiu com código ${code}: ${stderr.trim()}`));
      }
    });
  });

  const removed = await pruneOldBackups();
  return { filePath, removed };
}

if (require.main === module) {
  require('dotenv').config();
  runBackup()
    .then(({ filePath, removed }) => {
      console.log(`[backup] backup salvo em ${filePath} (removidos ${removed} backup(s) antigo(s))`);
    })
    .catch((err) => {
      console.error('[backup] falhou:', err.message);
      process.exitCode = 1;
    });
}

module.exports = { runBackup, BACKUP_DIR };
