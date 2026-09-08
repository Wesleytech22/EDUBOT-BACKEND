// Paleta alinhada ao tema visual do EduBot (frontend/src/styles/tokens.css).
const COLORS = {
  navy: '#1b2a5b',
  primary: '#3a38a0',
  primaryLight: '#e8e7f8',
  canvas: '#f1f4f9',
  border: '#d6ddea',
  textDark: '#101828',
  textMuted: '#475467',
  textFaint: '#98a2b3',
};

function passwordResetEmail(resetLink) {
  const subject = 'EduBot — Redefinição de senha';

  const text = [
    'EduBot — Redefinição de senha',
    '',
    'Recebemos um pedido para redefinir a senha da sua conta.',
    `Acesse o link a seguir para escolher uma nova senha (válido por 1 hora): ${resetLink}`,
    '',
    'Se você não solicitou isso, ignore este e-mail — sua senha continua a mesma.',
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0; padding:0; background:${COLORS.canvas}; font-family:'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.canvas}; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background:#ffffff; border:1px solid ${COLORS.border}; border-radius:12px; overflow:hidden;">
            <tr>
              <td style="background:${COLORS.navy}; padding:28px 32px;">
                <span style="font-size:22px; font-weight:700; color:#ffffff;">EduBot 🎓</span>
                <div style="margin-top:4px; font-size:13px; color:#dfe4f2;">
                  Gestão de oportunidades e acompanhamento escolar
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 12px; font-size:19px; color:${COLORS.textDark};">Redefinir sua senha</h1>
                <p style="margin:0 0 24px; font-size:14px; line-height:1.6; color:${COLORS.textMuted};">
                  Recebemos um pedido para redefinir a senha da sua conta EduBot.
                  Clique no botão abaixo para escolher uma nova senha. O link é
                  válido por <strong>1 hora</strong>.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:8px; background:${COLORS.primary};">
                      <a href="${resetLink}" style="display:inline-block; padding:13px 28px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:8px;">
                        Redefinir minha senha
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0; font-size:12px; line-height:1.6; color:${COLORS.textFaint};">
                  Se o botão não funcionar, copie e cole este link no navegador:<br />
                  <a href="${resetLink}" style="color:${COLORS.primary}; word-break:break-all;">${resetLink}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background:${COLORS.primaryLight}; border-top:1px solid ${COLORS.border};">
                <p style="margin:0; font-size:12px; color:${COLORS.textMuted};">
                  Se você não solicitou essa redefinição, ignore este e-mail — sua senha continua a mesma.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0; font-size:11px; color:${COLORS.textFaint};">EduBot · Plataforma de gestão de oportunidades educacionais</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

module.exports = { passwordResetEmail };
