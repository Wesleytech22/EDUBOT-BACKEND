require('dotenv').config();
const app = require('./app');
const { syncAllSchools } = require('./utils/studentsSync');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`EduBot API (Sprint 06) rodando em http://localhost:${PORT}`);
});

// RF-16 — sincronização periódica dos dados da planilha de cada escola,
// mantendo o dashboard escolar atualizado sem intervenção manual.
const SYNC_INTERVAL_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 15);
if (SYNC_INTERVAL_MINUTES > 0) {
  setInterval(() => {
    syncAllSchools().catch((err) => console.error('Falha na sincronização periódica (RF-16):', err));
  }, SYNC_INTERVAL_MINUTES * 60 * 1000);
  console.log(`Sincronização periódica da planilha a cada ${SYNC_INTERVAL_MINUTES} minuto(s) (RF-16), para todas as escolas.`);
}
