const { callTelegram, apiUrl, redact } = require('./bot');

// Hotfix (06/10/2026): em produção não há N8N, então o disparo pelo
// Telegram sai direto do backend, pelo próprio bot. O comportamento é o
// mesmo do workflow infra/n8n/broadcast-telegram.json: o texto vai primeiro;
// o anexo sobe uma vez só e os demais contatos recebem pelo file_id.

const UPLOAD_TIMEOUT_MS = 30000; // anexo de até 5 MB

async function uploadAttachment(chatId, attachment) {
  const isPhoto = String(attachment.mimeType).startsWith('image/');
  const method = isPhoto ? 'sendPhoto' : 'sendDocument';
  const field = isPhoto ? 'photo' : 'document';

  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append(
    field,
    new Blob([Buffer.from(attachment.base64, 'base64')], { type: attachment.mimeType }),
    attachment.fileName || 'anexo'
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl(method), { method: 'POST', body: form, signal: controller.signal });
    const data = await res.json();
    if (!data.ok) throw new Error(redact(data.description || `Telegram respondeu ${res.status}`));
    const fileId = isPhoto ? data.result.photo[data.result.photo.length - 1].file_id : data.result.document.file_id;
    return { method, field, fileId, messageId: data.result.message_id };
  } finally {
    clearTimeout(timer);
  }
}

// contacts: [{ logId, telegramChatId }] — devolve [{ logId, status, detail }]
// no mesmo formato do callback do N8N (RF-06).
async function sendBroadcastViaTelegram({ contacts, message, attachment = null }) {
  const results = [];

  for (const c of contacts) {
    if (!c.telegramChatId) {
      results.push({
        logId: c.logId,
        status: 'falha',
        detail: 'Contato ainda não vinculou o Telegram (abrir o bot e compartilhar o número).',
      });
      continue;
    }
    try {
      const sent = await callTelegram('sendMessage', { chat_id: c.telegramChatId, text: message });
      results.push({
        logId: c.logId,
        status: 'enviado',
        detail: `Entregue no Telegram (mensagem ${sent.message_id}).`,
        chatId: c.telegramChatId,
        messageId: sent.message_id,
      });
    } catch (err) {
      results.push({ logId: c.logId, status: 'falha', detail: redact(`Telegram recusou o envio: ${err.message}`) });
    }
  }

  // Se só o anexo falhar, a mensagem continua entregue e o motivo vai para o detalhe.
  if (attachment && attachment.base64) {
    let upload = null;
    let uploadError = null;
    for (const r of results.filter((item) => item.status === 'enviado')) {
      if (!upload && uploadError) {
        r.detail = `Mensagem entregue (${r.messageId}), mas o anexo não foi enviado: ${uploadError}`;
        continue;
      }
      try {
        if (!upload) {
          upload = await uploadAttachment(r.chatId, attachment);
          r.detail = `Entregue no Telegram com o anexo (mensagens ${r.messageId} e ${upload.messageId}).`;
          continue;
        }
        const sent = await callTelegram(upload.method, { chat_id: r.chatId, [upload.field]: upload.fileId });
        r.detail = `Entregue no Telegram com o anexo (mensagens ${r.messageId} e ${sent.message_id}).`;
      } catch (err) {
        const reason = redact(err.message);
        if (!upload) uploadError = reason;
        r.detail = `Mensagem entregue (${r.messageId}), mas o anexo não foi enviado: ${reason}`;
      }
    }
  }

  return results.map(({ logId, status, detail }) => ({ logId, status, detail }));
}

module.exports = { sendBroadcastViaTelegram };
