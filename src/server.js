require('dotenv').config();
const app = require('./app');
const { syncStudentsFromSheet } = require('./utils/studentsSync');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`EduBot API (Sprint 06) rodando em http://localhost:${PORT}`);
});

// RF-16 — sincronização periódica dos dados da planilha, mantendo a
// visualização do dashboard escolar atualizada sem intervenção manual.
const SYNC_INTERVAL_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 15);
if (SYNC_INTERVAL_MINUTES > 0) {
  setInterval(() => {
    syncStudentsFromSheet().catch((err) => console.error('Falha na sincronização periódica (RF-16):', err));
  }, SYNC_INTERVAL_MINUTES * 60 * 1000);
  console.log(`Sincronização periódica da planilha a cada ${SYNC_INTERVAL_MINUTES} minuto(s) (RF-16).`);
}
