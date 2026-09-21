const { parse } = require('csv-parse/sync');

// RF-15 — parseia o CSV exportado da planilha (Google Sheets: Arquivo >
// Fazer download > Valores separados por vírgula) em linhas de texto, no
// mesmo formato (array de arrays) devolvido pela API do Google Sheets.
// Diferente do modo "link" (onde o intervalo já exclui o cabeçalho, por
// escolha de quem configura o range), aqui a primeira linha do arquivo é
// sempre tratada como cabeçalho e descartada — é como toda planilha
// exportada do Google Sheets/Excel vem por padrão.
function parseCsvBuffer(buffer) {
  try {
    return parse(buffer, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      from_line: 2,
    });
  } catch (err) {
    throw Object.assign(new Error(`Não foi possível ler o arquivo CSV: ${err.message}`), { status: 400 });
  }
}

module.exports = { parseCsvBuffer };
