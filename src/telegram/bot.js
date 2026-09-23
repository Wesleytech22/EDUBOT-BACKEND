const pool = require('../db/pool');
const { processInboundMessage } = require('../controllers/whatsapp.controller');

// Canal Telegram (branch de avaliação, Sprint 04) — alternativa ao WhatsApp
// via WAHA, cujo pareamento o WhatsApp bloqueia. Usa a Bot API oficial em
// long polling (getUpdates): o backend busca as mensagens, então não é
// preciso expor uma URL pública (túnel HTTPS) como exigiria um webhook.
//
// O contato continua identificado pelo telefone: na primeira conversa o bot
// pede "Compartilhar meu número" e grava o chat_id em contacts, de modo que
// opt-in, broadcast, métricas e atendimento seguem iguais aos do WhatsApp.

const POLL_TIMEOUT_S = 25;
const RETRY_DELAY_MS = 5000;

// Teclado fixo com os comandos do chatbot (RF-07 a RF-11).
const MAIN_KEYBOARD = {
  keyboard: [[{ text: 'MENU' }, { text: 'ATENDENTE' }], [{ text: 'ENTRAR' }, { text: 'SAIR' }]],
  resize_keyboard: true,
  is_persistent: true,
};

const SHARE_CONTACT_KEYBOARD = {
  keyboard: [[{ text: '📱 Compartilhar meu número', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

// Comandos de barra do Telegram mapeados para os comandos do chatbot.
const SLASH_COMMANDS = {
  '/menu': 'MENU',
  '/entrar': 'ENTRAR',
  '/sair': 'SAIR',
  '/atendente': 'ATENDENTE',
};

// O token vive só no .env (TELEGRAM_BOT_TOKEN). Qualquer texto que possa
// ir para log, banco ou tela passa por aqui para nunca expor o token.
function redact(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const value = String(text ?? '');
  return token ? value.split(token).join('***') : value;
}

// Formato oficial do token do @BotFather: <id numérico>:<35 caracteres>.
const TOKEN_FORMAT = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

function apiUrl(method) {
  const base = process.env.TELEGRAM_API_URL || 'https://api.telegram.org';
  return `${base}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
}

async function callTelegram(method, payload, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(redact(data.description || `Telegram respondeu ${res.status}`));
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

function sendMessage(chatId, text, replyMarkup = MAIN_KEYBOARD) {
  return callTelegram('sendMessage', { chat_id: chatId, text, reply_markup: replyMarkup });
}

function normalizePhone(raw) {
  return `+${String(raw).replace(/\D/g, '')}`;
}

function displayName(from) {
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || null;
}

// Vincula o chat ao contato do telefone compartilhado (cria o contato, sem
// opt-in, se ainda não existir — o opt-in continua explícito via ENTRAR).
async function linkContact(chatId, phone, name) {
  await pool.query('UPDATE contacts SET telegram_chat_id = NULL WHERE telegram_chat_id = $1 AND phone <> $2', [
    chatId,
    phone,
  ]);
  const { rows } = await pool.query(
    `INSERT INTO contacts (phone, name, opt_in, telegram_chat_id) VALUES ($1, $2, false, $3)
     ON CONFLICT (phone) DO UPDATE SET telegram_chat_id = EXCLUDED.telegram_chat_id,
       name = COALESCE(contacts.name, EXCLUDED.name)
     RETURNING *`,
    [phone, name, chatId]
  );
  return rows[0];
}

async function findContactByChat(chatId) {
  const { rows } = await pool.query('SELECT * FROM contacts WHERE telegram_chat_id = $1', [chatId]);
  return rows[0] || null;
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || msg.chat.type !== 'private') return; // grupos e canais ficam de fora
  const chatId = msg.chat.id;

  if (msg.contact) {
    // Só aceita o próprio número — impede vincular o telefone de outra pessoa.
    if (msg.contact.user_id !== msg.from.id) {
      await sendMessage(chatId, 'Por segurança, compartilhe o seu próprio número pelo botão abaixo.', SHARE_CONTACT_KEYBOARD);
      return;
    }
    const contact = await linkContact(chatId, normalizePhone(msg.contact.phone_number), displayName(msg.from));
    await sendMessage(
      chatId,
      contact.opt_in
        ? 'Número vinculado! Você já recebe os avisos de oportunidades. Envie MENU para ver as ativas.'
        : 'Número vinculado! Envie ENTRAR para receber os avisos de oportunidades educacionais da escola.'
    );
    return;
  }

  if (!msg.text) return;
  const contact = await findContactByChat(chatId);

  if (!contact) {
    await sendMessage(
      chatId,
      'Olá! Eu sou o EduBot, o assistente de oportunidades educacionais da escola. Para começar, toque em "Compartilhar meu número" abaixo.',
      SHARE_CONTACT_KEYBOARD
    );
    return;
  }

  const text = msg.text.trim();
  const command = text.toLowerCase() === '/start' ? 'MENU' : SLASH_COMMANDS[text.toLowerCase().split('@')[0]];
  const { reply } = await processInboundMessage({
    phone: contact.phone,
    name: contact.name,
    message: command || text,
  });
  await sendMessage(chatId, reply);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollLoop() {
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const updates = await callTelegram(
        'getUpdates',
        { offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message'] },
        { timeoutMs: (POLL_TIMEOUT_S + 10) * 1000 }
      );
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await handleUpdate(update);
        } catch (err) {
          console.error('[telegram] erro ao processar mensagem:', redact(err.message));
        }
      }
    } catch (err) {
      console.error('[telegram] falha no getUpdates:', redact(err.message));
      await sleep(RETRY_DELAY_MS);
    }
  }
}

function startTelegramBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  if (!TOKEN_FORMAT.test(process.env.TELEGRAM_BOT_TOKEN)) {
    console.error('[telegram] TELEGRAM_BOT_TOKEN com formato inválido — canal Telegram desligado.');
    return;
  }
  console.log('Canal Telegram ativo (long polling).');
  pollLoop();
}

module.exports = { startTelegramBot, handleUpdate };
