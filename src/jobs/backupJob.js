const cron = require('node-cron');
const { runBackup } = require('../db/backup');

const ENABLED = String(process.env.BACKUP_CRON_ENABLED).toLowerCase() !== 'false';
const SCHEDULE = process.env.BACKUP_CRON || '0 3 * * *';

function startBackupJob() {
  if (!ENABLED) {
    console.log('[backup] rotina agendada desativada (BACKUP_CRON_ENABLED=false)');
    return null;
  }

  return cron.schedule(SCHEDULE, async () => {
    try {
      const { filePath, removed } = await runBackup();
      console.log(`[backup] backup agendado salvo em ${filePath} (removidos ${removed} backup(s) antigo(s))`);
    } catch (err) {
      console.error('[backup] backup agendado falhou:', err.message);
    }
  });
}

module.exports = { startBackupJob };
