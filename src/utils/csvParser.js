const { parse } = require('csv-parse/sync');

// Parseia o CSV exportado da planilha (Google Sheets/Excel: Arquivo > Fazer
// download > CSV) no mesmo formato (array de arrays de texto) devolvido pela
// API do Google Sheets. O cabeçalho não é descartado aqui — quem sincroniza
// reconhece e ignora a linha de cabeçalho (ver studentsSync.js), assim um
// CSV sem cabeçalho não perde o primeiro aluno. Aceita vírgula ou
// ponto e vírgula (padrão do Excel em português).
function parseCsvBuffer(buffer) {
  const text = buffer.toString('utf8');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

  try {
    return parse(text, {
      bom: true,
      delimiter,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });
  } catch (err) {
    throw Object.assign(new Error(`Não foi possível ler o arquivo CSV: ${err.message}`), { status: 400 });
  }
}

module.exports = { parseCsvBuffer };
