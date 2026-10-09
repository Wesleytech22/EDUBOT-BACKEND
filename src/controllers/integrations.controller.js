const pool = require('../db/pool');
const { extractSheetId, resolveSheetRows } = require('../utils/googleSheets');
const { parseCsvBuffer } = require('../utils/csvParser');

const PREVIEW_ROW_LIMIT = 20;

async function getConfigRow() {
  const { rows } = await pool.query('SELECT * FROM sheet_config WHERE id = 1');
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
    updatedAt: config?.updated_at || null,
  };
}

// Consulta qual planilha (link ao vivo ou arquivo anexado) está configurada.
async function getSheetConfig(req, res, next) {
  try {
    return res.json(serializeConfig(await getConfigRow()));
  } catch (err) {
    return next(err);
  }
}

// Modo "link": o Administrador cola o link da planilha e o intervalo lido.
async function updateSheetConfig(req, res, next) {
  try {
    const { sheetUrl, sheetRange } = req.body;
    const sheetId = extractSheetId(sheetUrl);
    if (!sheetId) {
      return res.status(400).json({ error: 'Cole o link completo da planilha do Google Sheets.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO sheet_config (id, source, sheet_id, sheet_range, updated_by, updated_at)
       VALUES (1, 'api', $1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET
         source = 'api',
         sheet_id = EXCLUDED.sheet_id,
         sheet_range = EXCLUDED.sheet_range,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [sheetId, String(sheetRange || '').trim() || 'A:E', req.user.sub]
    );

    return res.json({ config: serializeConfig(rows[0]) });
  } catch (err) {
    return next(err);
  }
}

// Modo "arquivo": o Administrador anexa um CSV exportado da planilha, para
// escolas que preferem não compartilhar o link.
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

    const { rows } = await pool.query(
      `INSERT INTO sheet_config (id, source, uploaded_filename, uploaded_rows, uploaded_at, updated_by, updated_at)
       VALUES (1, 'upload', $1, $2, now(), $3, now())
       ON CONFLICT (id) DO UPDATE SET
         source = 'upload',
         uploaded_filename = EXCLUDED.uploaded_filename,
         uploaded_rows = EXCLUDED.uploaded_rows,
         uploaded_at = now(),
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [req.file.originalname.slice(0, 255), JSON.stringify(values), req.user.sub]
    );

    return res.json({ config: serializeConfig(rows[0]), rowCount: values.length });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

// Lê a planilha configurada agora e devolve as primeiras linhas cruas, sem
// gravar nada — para conferir colunas e intervalo antes de sincronizar.
async function previewSheet(req, res, next) {
  try {
    const { range, values } = await resolveSheetRows(await getConfigRow());
    return res.json({ range, totalRows: values.length, values: values.slice(0, PREVIEW_ROW_LIMIT) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

module.exports = {
  getSheetConfig,
  updateSheetConfig,
  uploadSheetFile,
  previewSheet,
};
