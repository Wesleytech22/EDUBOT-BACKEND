const dns = require('dns');
const net = require('net');
const nodemailer = require('nodemailer');
const { passwordResetEmail } = require('./emailTemplates');

let transporterPromise;

// O nodemailer resolve o host SMTP com sua própria lógica (dns.resolve4/6,
// que usa o resolver de rede diretamente), não com dns.lookup do Node — em
// alguns ambientes de container (ex.: Render) o resolve4 não retorna nada e
// só sobra o endereço IPv6, que fica inalcançável (ENETUNREACH). Resolvendo
// o IPv4 manualmente aqui com dns.lookup (mecanismo do SO, mais confiável em
// containers) e passando o IP já pronto, evitamos essa resolução problemática.
async function resolveIPv4(hostname) {
  if (net.isIP(hostname)) return hostname;
  const { address } = await dns.promises.lookup(hostname, { family: 4 });
  return address;
}

// RNF — em produção, SMTP_HOST/PORT/USER/PASS vêm de um provedor real
// (SES, SendGrid, Mailgun etc.) configurado via .env. Sem essas variáveis
// (ambiente local sem credenciais), cai para uma conta Ethereal de teste,
// que também entrega por SMTP de verdade — só não sai da caixa de teste.
async function getTransporter() {
  if (transporterPromise) return transporterPromise;

  if (process.env.SMTP_HOST) {
    transporterPromise = resolveIPv4(process.env.SMTP_HOST).then((ipv4Host) =>
      nodemailer.createTransport({
        host: ipv4Host,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
        // Nome original do host para SNI e validação do certificado TLS,
        // já que a conexão em si usa o IP resolvido acima.
        tls: { servername: process.env.SMTP_HOST },
        // Falha em segundos em vez de travar a requisição indefinidamente
        // quando o host/porta SMTP estiver incorreto ou inacessível.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
      })
    );
  } else {
    transporterPromise = nodemailer.createTestAccount().then((testAccount) => {
      console.warn('[mailer] SMTP_HOST não configurado — usando conta Ethereal de teste (não chega a caixas reais).');
      return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
    });
  }

  return transporterPromise;
}

async function sendPasswordResetEmail(to, resetLink) {
  const transporter = await getTransporter();
  const { subject, text, html } = passwordResetEmail(resetLink);

  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || 'EduBot 🎓 <nao-responda@edubot.local>',
    to,
    subject,
    text,
    html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`[mailer] e-mail de teste (Ethereal) enviado — preview: ${previewUrl}`);
  }

  return info;
}

module.exports = { sendPasswordResetEmail };
