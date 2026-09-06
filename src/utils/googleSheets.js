// RF-14 — leitura da planilha via API do Google Sheets. Usa uma API key
// simples (sem OAuth/service account), adequada a uma planilha que a
// escola compartilha como "qualquer pessoa com o link pode visualizar" —
// suficiente para a prova de conceito desta Sprint.
const SHEETS_TIMEOUT_MS = 8000;

async function fetchSheetValues(sheetId, range) {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('GOOGLE_SHEETS_API_KEY não configurada.'), { status: 400 });
  }
  if (!sheetId) {
    throw Object.assign(new Error('Nenhuma planilha configurada (RF-15).'), { status: 400 });
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(
    range
  )}?key=${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHEETS_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = body?.error?.message || `Google Sheets respondeu com status ${res.status}.`;
      throw Object.assign(new Error(message), { status: 502 });
    }

    return { range: body.range, values: body.values || [] };
  } catch (err) {
    if (err.status) throw err;
    throw Object.assign(new Error(`Falha ao consultar o Google Sheets: ${err.message}`), { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

// RF-15 — aceita tanto o ID isolado quanto o link completo colado do
// navegador (ex.: https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0),
// para não exigir que o Administrador saiba extrair o ID na mão.
function extractSheetId(input) {
  const text = String(input || '').trim();
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : text;
}

// Fonte única de leitura para o restante do sistema (prévia e sincronização
// do dashboard escolar): resolve tanto o modo "api" (Google Sheets ao vivo)
// quanto o modo "upload" (último CSV anexado), sem que quem chama precise
// saber qual dos dois está configurado.
async function resolveSheetRows(config) {
  if (!config) {
    throw Object.assign(new Error('Nenhuma planilha configurada (RF-15).'), { status: 400 });
  }

  if (config.source === 'upload') {
    if (!config.uploaded_rows) {
      throw Object.assign(new Error('Nenhum arquivo foi anexado ainda (RF-15).'), { status: 400 });
    }
    return { range: config.uploaded_filename, values: config.uploaded_rows };
  }

  return fetchSheetValues(config.sheet_id, config.sheet_range);
}

module.exports = { fetchSheetValues, extractSheetId, resolveSheetRows };
