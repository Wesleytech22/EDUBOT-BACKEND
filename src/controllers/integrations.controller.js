const pool = require('../db/pool');
const { extractSheetId, resolveSheetRows } = require('../utils/googleSheets');
const { parseCsvBuffer } = require('../utils/csvParser');
const { syncStudentsFromSheet, extractStudents, NO_VALID_ROWS_MESSAGE } = require('../utils/studentsSync');

// Frequências oferecidas na tela (em minutos). 0 = só sincronização manual.
const SYNC_INTERVAL_OPTIONS = [0, 15, 30, 60, 360, 1440];
const PREVIEW_ROW_LIMIT = 20;

// Multi-escola — uma configuração de planilha por escola.
async function getConfigRow(schoolId) {
  const { rows } = await pool.query('SELECT * FROM sheet_config WHERE school_id = $1', [schoolId]);
  return rows[0] || null;
}

function serializeConfig(config) {
  return {
    configured: Boolean(config && (config.source === 'upload' ? config.uploaded_rows : config.sheet_id)),
    source: config?.source || 'api',
    sheetId: config?.sheet_id || null,
    sheetRange: config?.sheet_range || 'A:E',
    uploadedFilename: config?.uploaded_filename || null,
    uploadedAt: config?.uploaded_at || null,
    syncIntervalMinutes: config?.sync_interval_minutes ?? 60,
    syncIntervalOptions: SYNC_INTERVAL_OPTIONS,
    updatedAt: config?.updated_at || null,
  };
}

function parseInterval(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  return SYNC_INTERVAL_OPTIONS.includes(value) ? value : null;
}

// Consulta qual planilha (link ao vivo ou arquivo anexado) está configurada.
async function getSheetConfig(req, res, next) {
  try {
    return res.json(serializeConfig(await getConfigRow(req.schoolId)));
  } catch (err) {
    return next(err);
  }
}

// Modo "link": o Administrador cola o link da planilha e o intervalo lido.
// Ao salvar, já roda uma sincronização para o painel refletir a planilha
// nova na hora — se ela falhar, a configuração continua salva e o motivo
// volta para a tela.
async function updateSheetConfig(req, res, next) {
  try {
    const { sheetUrl, sheetRange, syncIntervalMinutes } = req.body;
    const sheetId = extractSheetId(sheetUrl);
    if (!sheetId) {
      return res.status(400).json({ error: 'Cole o link completo da planilha do Google Sheets.' });
    }
    const interval = parseInterval(syncIntervalMinutes);
    if (interval === null) {
      return res.status(400).json({ error: 'Frequência de sincronização inválida.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO sheet_config (school_id, source, sheet_id, sheet_range, sync_interval_minutes, updated_by, updated_at)
       VALUES ($5, 'api', $1, $2, COALESCE($3, 60), $4, now())
       ON CONFLICT (school_id) DO UPDATE SET
         source = 'api',
         sheet_id = EXCLUDED.sheet_id,
         sheet_range = EXCLUDED.sheet_range,
         sync_interval_minutes = COALESCE($3, sheet_config.sync_interval_minutes),
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [sheetId, String(sheetRange || '').trim() || 'A:E', interval ?? null, req.user.sub, req.schoolId]
    );

    const sync = await syncStudentsFromSheet({ schoolId: req.schoolId, trigger: 'manual' });
    return res.json({ config: serializeConfig(rows[0]), sync });
  } catch (err) {
    return next(err);
  }
}

// Modo "arquivo": o Administrador anexa um CSV exportado da planilha, para
// escolas que preferem não compartilhar o link. Também sincroniza na hora.
async function uploadSheetFile(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Selecione um arquivo CSV para enviar.' });
    }
    const isCsv = /\.csv$/i.test(req.file.originalname) || req.file.mimetype === 'text/csv';
    if (!isCsv) {
      return res
        .status(400)
        .json({ error: 'Envie um arquivo .csv — no Google Sheets: Arquivo > Fazer download > Valores separados por vírgula.' });
    }

    const values = parseCsvBuffer(req.file.buffer);
    if (values.length === 0) {
      return res.status(400).json({ error: 'O arquivo CSV está vazio.' });
    }
    // Recusa antes de salvar: um arquivo sem nenhum aluno não pode tomar o
    // lugar do último CSV bom.
    if (extractStudents(values).students.length === 0) {
      return res.status(400).json({ error: NO_VALID_ROWS_MESSAGE });
    }

    const { rows } = await pool.query(
      `INSERT INTO sheet_config (school_id, source, uploaded_filename, uploaded_rows, uploaded_at, updated_by, updated_at)
       VALUES ($4, 'upload', $1, $2, now(), $3, now())
       ON CONFLICT (school_id) DO UPDATE SET
         source = 'upload',
         uploaded_filename = EXCLUDED.uploaded_filename,
         uploaded_rows = EXCLUDED.uploaded_rows,
         uploaded_at = now(),
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [req.file.originalname.slice(0, 255), JSON.stringify(values), req.user.sub, req.schoolId]
    );

    const sync = await syncStudentsFromSheet({ schoolId: req.schoolId, trigger: 'manual' });
    return res.json({ config: serializeConfig(rows[0]), rowCount: values.length, sync });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

// Só a frequência da sincronização automática, sem mexer na origem dos dados.
async function updateSyncSettings(req, res, next) {
  try {
    const interval = parseInterval(req.body.syncIntervalMinutes);
    if (interval === undefined || interval === null) {
      return res.status(400).json({ error: 'Frequência de sincronização inválida.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO sheet_config (school_id, sync_interval_minutes, updated_by, updated_at)
       VALUES ($3, $1, $2, now())
       ON CONFLICT (school_id) DO UPDATE SET
         sync_interval_minutes = EXCLUDED.sync_interval_minutes,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [interval, req.user.sub, req.schoolId]
    );
    return res.json(serializeConfig(rows[0]));
  } catch (err) {
    return next(err);
  }
}

// Lê a planilha configurada agora e devolve as primeiras linhas cruas, sem
// gravar nada — para conferir colunas e intervalo antes de sincronizar.
async function previewSheet(req, res, next) {
  try {
    const { range, values } = await resolveSheetRows(await getConfigRow(req.schoolId));
    return res.json({ range, totalRows: values.length, values: values.slice(0, PREVIEW_ROW_LIMIT) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

// Histórico de sincronizações, com as falhas expostas junto dos sucessos.
async function listSyncRuns(req, res, next) {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { rows } = await pool.query('SELECT * FROM sync_runs WHERE school_id = $1 ORDER BY created_at DESC LIMIT $2', [
      req.schoolId,
      limit,
    ]);
    return res.json({
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        trigger: r.trigger_type,
        rowsSynced: r.rows_synced,
        rowsSkipped: r.rows_skipped,
        detail: r.detail,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getSheetConfig,
  updateSheetConfig,
  uploadSheetFile,
  updateSyncSettings,
  previewSheet,
  listSyncRuns,
};
