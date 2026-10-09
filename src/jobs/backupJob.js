const cron = require('node-cron');
const { runBackup } = require('../db/backup');

const ENABLED = String(process.env.BACKUP_CRON_ENABLED).toLowerCase() !== 'false';
const SCHEDULE = process.env.BACKUP_CRON || '0 3 * * *';
const TIMEZONE = process.env.BACKUP_CRON_TZ || 'America/Sao_Paulo';

let task = null;

function startBackupJob() {
  if (!ENABLED) {
    console.log('[backup] rotina agendada desativada (BACKUP_CRON_ENABLED=false)');
    return null;
  }

  task = cron.schedule(
    SCHEDULE,
    async () => {
      try {
        const { filePath, removed } = await runBackup({ trigger: 'automatico' });
        console.log(`[backup] backup agendado salvo em ${filePath} (removidos ${removed} backup(s) antigo(s))`);
      } catch (err) {
        console.error('[backup] backup agendado falhou:', err.message);
      }
    },
    { timezone: TIMEZONE }
  );
  return task;
}

// Usado pela tela "Segurança · Backups" para mostrar o próximo backup.
function getBackupSchedule() {
  return {
    enabled: Boolean(task),
    cron: SCHEDULE,
    timezone: TIMEZONE,
    nextRunAt: task?.getNextRun?.() || null,
  };
}

module.exports = { startBackupJob, getBackupSchedule };
