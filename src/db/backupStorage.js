const { Pool } = require('pg');

// Armazenamento permanente dos backups (Sprint 05). O disco do servidor no
// plano gratuito do Render é temporário — apagado a cada deploy, reinício ou
// quando o serviço dorme —, então cada backup comprimido é guardado num banco
// próprio para isso (BACKUP_STORAGE_URL: a branch "backups" do Neon),
// separado do banco da escola. Vários ambientes podem dividir o mesmo banco
// de backups: cada um grava com o seu nome (BACKUP_ENVIRONMENT) e a retenção
// vale por ambiente. Sem BACKUP_STORAGE_URL, os backups ficam só no disco
// (como antes), e a tela avisa que não são permanentes.

const STORAGE_URL = process.env.BACKUP_STORAGE_URL || '';
const ENVIRONMENT = (process.env.BACKUP_ENVIRONMENT || 'local').trim().toLowerCase();

let pool = null;
let tableReady = null;

function isEnabled() {
  return Boolean(STORAGE_URL);
}

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: STORAGE_URL, max: 2 });
  }
  return pool;
}

function ensureTable() {
  if (!tableReady) {
    tableReady = getPool()
      .query(
        `CREATE TABLE IF NOT EXISTS backup_files (
           id           SERIAL PRIMARY KEY,
           environment  VARCHAR(30) NOT NULL,
           file_name    TEXT NOT NULL,
           size_bytes   BIGINT NOT NULL,
           data         BYTEA NOT NULL,
           created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
           UNIQUE (environment, file_name)
         );
         CREATE INDEX IF NOT EXISTS idx_backup_files_env_created ON backup_files(environment, created_at DESC);`
      )
      .catch((err) => {
        tableReady = null;
        throw err;
      });
  }
  return tableReady;
}

// Grava o backup e apaga os mais antigos do mesmo ambiente além da retenção.
async function saveBackup({ fileName, data, retention }) {
  await ensureTable();
  const db = getPool();
  await db.query('INSERT INTO backup_files (environment, file_name, size_bytes, data) VALUES ($1, $2, $3, $4)', [
    ENVIRONMENT,
    fileName,
    data.length,
    data,
  ]);
  const { rowCount } = await db.query(
    `DELETE FROM backup_files
     WHERE environment = $1
       AND id NOT IN (SELECT id FROM backup_files WHERE environment = $1 ORDER BY created_at DESC, id DESC LIMIT $2)`,
    [ENVIRONMENT, retention]
  );
  return { removed: rowCount };
}

async function listBackups(environment = ENVIRONMENT) {
  await ensureTable();
  const { rows } = await getPool().query(
    'SELECT id, file_name, size_bytes, created_at FROM backup_files WHERE environment = $1 ORDER BY created_at DESC, id DESC',
    [environment]
  );
  return rows.map((r) => ({ id: r.id, fileName: r.file_name, sizeBytes: Number(r.size_bytes), createdAt: r.created_at }));
}

// Só para o comando de linha "npm run backup:baixar" — a API nunca serve o
// conteúdo de um backup.
async function readBackup({ environment = ENVIRONMENT, fileName } = {}) {
  await ensureTable();
  const { rows } = fileName
    ? await getPool().query('SELECT file_name, data FROM backup_files WHERE environment = $1 AND file_name = $2', [
        environment,
        fileName,
      ])
    : await getPool().query(
        'SELECT file_name, data FROM backup_files WHERE environment = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
        [environment]
      );
  return rows[0] ? { fileName: rows[0].file_name, data: rows[0].data } : null;
}

async function close() {
  if (pool) await pool.end();
}

module.exports = { isEnabled, saveBackup, listBackups, readBackup, close, ENVIRONMENT };
