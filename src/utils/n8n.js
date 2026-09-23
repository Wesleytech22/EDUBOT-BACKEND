// RF-04 — dispara o workflow do N8N (integrado à API do WAHA) que entrega o
// broadcast. A chamada é resiliente: se o N8N estiver indisponível (R-02),
// o disparo no banco não é desfeito — apenas os logs ficam marcados como
// falha, e o disparo pode ser diagnosticado pelos logs (RF-06).
const N8N_TIMEOUT_MS = 15000; // payload pode levar o anexo (até 5 MB) em base64

async function triggerBroadcastWorkflow({ opportunity, contacts, message, callbackUrl, attachment = null }) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;

  if (!webhookUrl) {
    return { ok: false, error: 'N8N_WEBHOOK_URL não configurada.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // attachment: { fileName, mimeType, base64 } ou null — o workflow do
      // Telegram envia o arquivo depois da mensagem.
      body: JSON.stringify({ opportunity, contacts, message, callbackUrl, attachment }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, error: `N8N respondeu com status ${res.status}.` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Falha ao contatar o N8N: ${err.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

// RF-05 — texto único, sem edição manual contato a contato.
function buildBroadcastMessage(opportunity) {
  const deadline = new Date(opportunity.deadline).toLocaleDateString('pt-BR');
  const lines = [
    `Nova oportunidade: ${opportunity.title}`,
    `Público: ${opportunity.targetAudience}`,
    `Inscrições até ${deadline}`,
  ];
  if (opportunity.link) lines.push(`Saiba mais: ${opportunity.link}`);
  lines.push('Responda MENU para ver todas as oportunidades ativas ou SAIR para deixar de receber.');
  return lines.join('\n');
}

module.exports = { triggerBroadcastWorkflow, buildBroadcastMessage };
