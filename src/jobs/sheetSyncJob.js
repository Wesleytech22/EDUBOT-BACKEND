const pool = require('../db/pool');
const { syncStudentsFromSheet } = require('../utils/studentsSync');

// Sincronização automática da planilha. A frequência é escolhida pelo
// Administrador na tela de Integração (sheet_config.sync_interval_minutes),
// então o job só confere a cada minuto se já passou o intervalo desde a
// última tentativa — trocar a frequência na tela vale sem reiniciar o
// servidor. SHEET_SYNC_ENABLED=false desliga a rotina (ex.: em dev local).
const CHECK_EVERY_MS = 60 * 1000;

// Multi-escola — percorre as escolas ativas com planilha configurada, cada
// uma na própria frequência; uma escola com falha não atrasa as outras.
async function tick() {
  const { rows } = await pool.query(
    `SELECT c.school_id, s.name AS school_name, c.sync_interval_minutes,
            (SELECT MAX(created_at) FROM sync_runs r WHERE r.school_id = c.school_id) AS last_run_at,
            now() AS now
     FROM sheet_config c
     JOIN schools s ON s.id = c.school_id AND s.active
     WHERE c.sync_interval_minutes > 0
       AND ((c.source = 'upload' AND c.uploaded_rows IS NOT NULL) OR (c.source = 'api' AND c.sheet_id IS NOT NULL))`
  );

  for (const config of rows) {
    const elapsedMs = config.last_run_at ? config.now - config.last_run_at : Infinity;
    if (elapsedMs < config.sync_interval_minutes * 60 * 1000) continue;

    const result = await syncStudentsFromSheet({ schoolId: config.school_id, trigger: 'automatica' });
    console.log(`[sync] ${config.school_name}: ${result.status} — ${result.detail}`);
  }
}

function startSheetSyncJob() {
  if (String(process.env.SHEET_SYNC_ENABLED).toLowerCase() === 'false') {
    console.log('[sync] sincronização automática da planilha desativada (SHEET_SYNC_ENABLED=false)');
    return null;
  }
  return setInterval(() => {
    tick().catch((err) => console.error('[sync] falha na sincronização automática:', err.message));
  }, CHECK_EVERY_MS);
}

module.exports = { startSheetSyncJob, runDueSyncs: tick };
