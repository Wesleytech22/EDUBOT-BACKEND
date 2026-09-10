require('dotenv').config();
const dns = require('dns');

// Em hosts sem saída IPv6 (ex.: Render), o Node pode resolver hosts como
// smtp.gmail.com para um endereço IPv6 primeiro e falhar com ENETUNREACH.
// Forçar IPv4 primeiro evita esse problema para toda conexão de saída
// (SMTP, APIs externas, etc.).
dns.setDefaultResultOrder('ipv4first');

const app = require('./app');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`EduBot API (Sprint 03) rodando em http://localhost:${PORT}`);
});
