const { parseCsvBuffer } = require('./csvParser');

// Leitura da planilha do Google Sheets. A planilha precisa estar
// compartilhada como "qualquer pessoa com o link pode visualizar".
//
// - Com GOOGLE_SHEETS_API_KEY: usa a API oficial (values.get), respeitando o
//   intervalo configurado.
// - Sem a chave: cai na exportação pública em CSV do próprio Google Sheets,
//   que dispensa credencial — assim a integração funciona sem configurar
//   nada além do link.
const SHEETS_TIMEOUT_MS = 10000;

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHEETS_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow' });
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'tempo de resposta esgotado' : err.message;
    throw httpError(`Falha ao consultar o Google Sheets: ${reason}.`, 502);
  } finally {
    clearTimeout(timeout);
  }
}

// "Alunos!A2:E" -> { sheetName: 'Alunos', cells: 'A2:E' }; "A:E" -> sem aba.
function splitRange(range) {
  const text = String(range || '').trim();
  const bang = text.lastIndexOf('!');
  if (bang === -1) return { sheetName: null, cells: text || null };
  return { sheetName: text.slice(0, bang).replace(/^'|'$/g, ''), cells: text.slice(bang + 1) || null };
}

async function fetchViaApi(sheetId, range, apiKey) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(
    range
  )}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithTimeout(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message || `status ${res.status}`;
    throw httpError(`O Google Sheets recusou a leitura: ${message}`, 502);
  }
  return { range: body.range, values: body.values || [] };
}

async function fetchViaCsvExport(sheetId, range) {
  const { sheetName, cells } = splitRange(range);
  const params = new URLSearchParams({ tqx: 'out:csv' });
  if (sheetName) params.set('sheet', sheetName);
  if (cells) params.set('range', cells);

  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?${params}`;
  const res = await fetchWithTimeout(url);
  const contentType = res.headers.get('content-type') || '';

  // Planilha privada: o Google devolve a página de login (HTML) em vez do CSV.
  if (!res.ok || contentType.includes('text/html')) {
    throw httpError(
      'Não foi possível ler a planilha. Confira se ela está compartilhada como "qualquer pessoa com o link pode visualizar" e se o nome da aba está correto.',
      502
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return { range: range || 'A:Z', values: parseCsvBuffer(buffer) };
}

async function fetchSheetValues(sheetId, range) {
  if (!sheetId) throw httpError('Nenhuma planilha configurada.', 400);
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  return apiKey ? fetchViaApi(sheetId, range, apiKey) : fetchViaCsvExport(sheetId, range);
}

// Aceita tanto o ID isolado quanto o link completo colado do navegador
// (ex.: https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0).
function extractSheetId(input) {
  const text = String(input || '').trim();
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(text)) return text;
  return null;
}

// Fonte única de leitura para o restante do sistema (prévia e
// sincronização): resolve tanto o modo "api" (planilha ao vivo) quanto o
// modo "upload" (último CSV anexado), sem que quem chama precise saber qual
// dos dois está configurado.
async function resolveSheetRows(config) {
  if (!config) throw httpError('Nenhuma planilha configurada.', 400);

  if (config.source === 'upload') {
    if (!config.uploaded_rows) throw httpError('Nenhum arquivo foi anexado ainda.', 400);
    return { range: config.uploaded_filename, values: config.uploaded_rows };
  }

  return fetchSheetValues(config.sheet_id, config.sheet_range);
}

module.exports = { extractSheetId, resolveSheetRows };
