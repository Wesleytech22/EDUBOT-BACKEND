const pool = require('../db/pool');
const { syncStudentsFromSheet } = require('../utils/studentsSync');

// Sincronização automática da planilha. A frequência é escolhida pelo
// Administrador na tela de Integração (sheet_config.sync_interval_minutes),
// então o job só confere a cada minuto se já passou o intervalo desde a
// última tentativa — trocar a frequência na tela vale sem reiniciar o
// servidor. SHEET_SYNC_ENABLED=false desliga a rotina (ex.: em dev local).
const CHECK_EVERY_MS = 60 * 1000;

async function tick() {
  const { rows } = await pool.query(
    `SELECT c.sync_interval_minutes,
            (c.source = 'upload' AND c.uploaded_rows IS NOT NULL) OR (c.source = 'api' AND c.sheet_id IS NOT NULL) AS configured,
            (SELECT MAX(created_at) FROM sync_runs) AS last_run_at,
            now() AS now
     FROM sheet_config c WHERE c.id = 1`
  );
  const config = rows[0];
  if (!config || !config.configured || config.sync_interval_minutes <= 0) return;

  const elapsedMs = config.last_run_at ? config.now - config.last_run_at : Infinity;
  if (elapsedMs < config.sync_interval_minutes * 60 * 1000) return;

  const result = await syncStudentsFromSheet({ trigger: 'automatica' });
  console.log(`[sync] sincronização automática: ${result.status} — ${result.detail}`);
}

function startSheetSyncJob() {
  if (String(process.env.SHEET_SYNC_ENABLED).toLowerCase() === 'false') {
    console.log('[sync] sincronização automática da planilha desativada (SHEET_SYNC_ENABLED=false)');
    return null;
  }
  const run = () => tick().catch((err) => console.error('[sync] falha na sincronização automática:', err.message));
  // Primeira verificação logo depois de subir: um reinício do servidor (deploy,
  // nodemon) não pode atrasar uma sincronização que já venceu.
  setTimeout(run, 5000);
  return setInterval(run, CHECK_EVERY_MS);
}

module.exports = { startSheetSyncJob };
