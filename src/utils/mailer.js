const nodemailer = require('nodemailer');
const { passwordResetEmail } = require('./emailTemplates');

let transporterPromise;

// RNF — em produção, SMTP_HOST/PORT/USER/PASS vêm de um provedor real
// (SES, SendGrid, Mailgun etc.) configurado via .env. Sem essas variáveis
// (ambiente local sem credenciais), cai para uma conta Ethereal de teste,
// que também entrega por SMTP de verdade — só não sai da caixa de teste.
async function getTransporter() {
  if (transporterPromise) return transporterPromise;

  if (process.env.SMTP_HOST) {
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
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
