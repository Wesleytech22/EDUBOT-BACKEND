const cron = require('node-cron');
const { runBackup, lastSuccessfulBackupAt } = require('../db/backup');

const ENABLED = String(process.env.BACKUP_CRON_ENABLED).toLowerCase() !== 'false';
const SCHEDULE = process.env.BACKUP_CRON || '0 3 * * *';
const TIMEZONE = process.env.BACKUP_CRON_TZ || 'America/Sao_Paulo';
// Idade máxima do último backup bem-sucedido antes de a rotina fazer um na
// hora. No plano gratuito do Render o servidor dorme sem uso e o horário
// agendado (03h) pode passar sem ninguém acordado — esta verificação garante
// o backup do dia no primeiro uso depois disso.
const MAX_AGE_HOURS = Number(process.env.BACKUP_MAX_AGE_HOURS) || 24;
const CHECK_EVERY_MS = 60 * 60 * 1000;

let task = null;

async function backupNow(reason) {
  try {
    const { filePath, removed } = await runBackup({ trigger: 'automatico' });
    console.log(`[backup] ${reason}: backup salvo em ${filePath} (removidos ${removed} antigo(s))`);
  } catch (err) {
    if (err.status === 409) return; // já havia um backup em andamento
    console.error(`[backup] ${reason}: falhou —`, err.message);
  }
}

async function catchUpIfStale() {
  try {
    const last = await lastSuccessfulBackupAt();
    const ageMs = last ? Date.now() - new Date(last).getTime() : Infinity;
    if (ageMs >= MAX_AGE_HOURS * 60 * 60 * 1000) {
      await backupNow(`último backup com mais de ${MAX_AGE_HOURS} h`);
    }
  } catch (err) {
    console.error('[backup] não foi possível verificar o último backup:', err.message);
  }
}

function startBackupJob() {
  if (!ENABLED) {
    console.log('[backup] rotina agendada desativada (BACKUP_CRON_ENABLED=false)');
    return null;
  }

  task = cron.schedule(SCHEDULE, () => backupNow('horário agendado'), { timezone: TIMEZONE });
  // Primeira verificação 1 min depois de subir (deixa as migrations e o
  // servidor estabilizarem) e depois de hora em hora.
  setTimeout(catchUpIfStale, 60 * 1000);
  setInterval(catchUpIfStale, CHECK_EVERY_MS);
  return task;
}

// Usado pela tela "Segurança · Backups" para mostrar o próximo backup.
function getBackupSchedule() {
  return {
    enabled: Boolean(task),
    cron: SCHEDULE,
    timezone: TIMEZONE,
    nextRunAt: task?.getNextRun?.() || null,
    maxAgeHours: MAX_AGE_HOURS,
  };
}

module.exports = { startBackupJob, getBackupSchedule };
