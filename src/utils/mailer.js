const dns = require('dns');
const net = require('net');
const nodemailer = require('nodemailer');
const { passwordResetEmail } = require('./emailTemplates');

const RESEND_API_URL = 'https://api.resend.com/emails';

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

// Envio via SMTP (nodemailer) — usado quando não há RESEND_API_KEY. Serve
// como opção para outros ambientes de hospedagem sem o bloqueio de saída
// SMTP do Render, e como fallback de teste local (conta Ethereal).
async function sendViaSmtp({ to, from, subject, text, html }) {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({ from, to, subject, text, html });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`[mailer] e-mail de teste (Ethereal) enviado — preview: ${previewUrl}`);
  }

  return info;
}

// Envio via API HTTP da Resend (porta 443) — usado em produção. Contorna o
// bloqueio de saída SMTP (portas 25/465/587) comum em provedores como o
// Render (confirmado nos logs: conexões SMTP para o Gmail travavam em
// ENETUNREACH/timeout mesmo com o IPv4 resolvido corretamente).
// Requer RESEND_API_KEY e, para enviar a qualquer destinatário (não só ao
// próprio e-mail cadastrado na Resend), um domínio verificado em MAIL_FROM.
async function sendViaResend({ to, from, subject, text, html }) {
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, text, html }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend respondeu ${response.status} ${response.statusText}: ${body}`);
  }

  return response.json();
}

async function sendPasswordResetEmail(to, resetLink) {
  const { subject, text, html } = passwordResetEmail(resetLink);
  const from = process.env.MAIL_FROM || 'EduBot 🎓 <nao-responda@edubot.local>';

  if (process.env.RESEND_API_KEY) {
    return sendViaResend({ to, from, subject, text, html });
  }

  return sendViaSmtp({ to, from, subject, text, html });
}

module.exports = { sendPasswordResetEmail };
