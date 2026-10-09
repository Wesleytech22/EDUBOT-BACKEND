const pool = require('../db/pool');
const { runBackup, RETENTION_COUNT } = require('../db/backup');
const { getBackupSchedule } = require('../jobs/backupJob');

function serializeRun(r) {
  return {
    id: r.id,
    status: r.status,
    trigger: r.trigger_type,
    fileName: r.file_name,
    sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
    removedCount: r.removed_count,
    detail: r.detail,
    createdAt: r.created_at,
  };
}

// Situação da rotina de backup: agenda, retenção, último backup que deu
// certo e o histórico recente (sucessos e falhas). Só metadados — o arquivo
// do dump nunca é servido pela API.
async function getStatus(req, res, next) {
  try {
    const { rows: history } = await pool.query('SELECT * FROM backup_runs ORDER BY created_at DESC LIMIT 20');
    const { rows: lastSuccess } = await pool.query(
      "SELECT * FROM backup_runs WHERE status = 'sucesso' ORDER BY created_at DESC LIMIT 1"
    );

    return res.json({
      schedule: getBackupSchedule(),
      retentionCount: RETENTION_COUNT,
      lastSuccess: lastSuccess[0] ? serializeRun(lastSuccess[0]) : null,
      history: history.map(serializeRun),
    });
  } catch (err) {
    return next(err);
  }
}

// Backup imediato, fora do agendamento — útil antes de uma manutenção.
async function runNow(req, res, next) {
  try {
    const result = await runBackup({ trigger: 'manual' });
    return res.json({ status: 'sucesso', fileName: result.fileName, sizeBytes: result.size, removed: result.removed });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message });
    return res.status(502).json({ status: 'falha', error: err.message });
  }
}

module.exports = { getStatus, runNow };
