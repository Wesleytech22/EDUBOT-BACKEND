const pool = require('../db/pool');
const { extractSheetId, resolveSheetRows } = require('../utils/googleSheets');
const { parseCsvBuffer } = require('../utils/csvParser');

async function getConfigRow() {
  const { rows } = await pool.query('SELECT * FROM sheet_config WHERE id = 1');
  return rows[0] || null;
}

// RF-15 — o Administrador consulta qual planilha (link ao vivo ou arquivo
// anexado) está configurada.
async function getSheetConfig(req, res, next) {
  try {
    const config = await getConfigRow();
    return res.json({
      source: config?.source || 'api',
      sheetId: config?.sheet_id || null,
      sheetRange: config?.sheet_range || 'A:Z',
      uploadedFilename: config?.uploaded_filename || null,
      uploadedAt: config?.uploaded_at || null,
      updatedAt: config?.updated_at || null,
    });
  } catch (err) {
    return next(err);
  }
}

// RF-15 — modo "link": o Administrador cola o link (ou o ID isolado) da
// planilha e o intervalo de dados consumido.
async function updateSheetConfig(req, res, next) {
  try {
    const { sheetUrl, sheetId: rawSheetId, sheetRange } = req.body;
    const input = sheetUrl || rawSheetId;
    if (!input || String(input).trim() === '') {
      return res.status(400).json({ error: 'Cole o link da planilha.' });
    }

    const sheetId = extractSheetId(input);

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
      [sheetId, sheetRange?.trim() || 'A:Z', req.user.sub]
    );

    return res.json({
      source: rows[0].source,
      sheetId: rows[0].sheet_id,
      sheetRange: rows[0].sheet_range,
      updatedAt: rows[0].updated_at,
    });
  } catch (err) {
    return next(err);
  }
}

// RF-15 — modo "arquivo": o Administrador anexa um CSV exportado da
// planilha, para escolas que preferem não compartilhar o link.
async function uploadSheetFile(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Selecione um arquivo CSV para enviar.' });
    }

    const isCsv = req.file.mimetype === 'text/csv' || req.file.originalname.toLowerCase().endsWith('.csv');
    if (!isCsv) {
      return res.status(400).json({ error: 'Envie um arquivo .csv — exporte a planilha em Arquivo > Fazer download > CSV.' });
    }

    const values = parseCsvBuffer(req.file.buffer);

    const { rows } = await pool.query(
      `INSERT INTO sheet_config (id, source, uploaded_filename, uploaded_rows, updated_by, updated_at, uploaded_at)
       VALUES (1, 'upload', $1, $2, $3, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         source = 'upload',
         uploaded_filename = EXCLUDED.uploaded_filename,
         uploaded_rows = EXCLUDED.uploaded_rows,
         updated_by = EXCLUDED.updated_by,
         updated_at = now(),
         uploaded_at = now()
       RETURNING *`,
      [req.file.originalname, JSON.stringify(values), req.user.sub]
    );

    return res.json({
      source: rows[0].source,
      uploadedFilename: rows[0].uploaded_filename,
      uploadedAt: rows[0].uploaded_at,
      rowCount: values.length,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

// RF-14 — prova de conceito de leitura: lê a planilha configurada (via
// API ou via arquivo anexado) e devolve as linhas cruas, sem gravar nada
// (a sincronização do dashboard escolar é o Módulo G, na Sprint 06).
async function previewSheet(req, res, next) {
  try {
    const config = await getConfigRow();
    const result = await resolveSheetRows(config);
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

module.exports = { getSheetConfig, updateSheetConfig, uploadSheetFile, previewSheet };
