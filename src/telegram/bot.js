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
// Com o multi-escola, a escola vem do link de entrada (/start <slug>).

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

// Multi-escola — um único bot atende todas as escolas. Cada chat conversa
// com uma escola por vez: a do link de entrada (t.me/<bot>?start=<slug>),
// guardada em telegram_chats junto com o telefone já compartilhado, para
// não pedir o número de novo quando a pessoa entra pelo link de outra escola.
async function getChat(chatId) {
  const { rows } = await pool.query(
    `SELECT tc.*, s.name AS school_name, s.active AS school_active
     FROM telegram_chats tc LEFT JOIN schools s ON s.id = tc.school_id
     WHERE tc.chat_id = $1`,
    [chatId]
  );
  return rows[0] || null;
}

async function saveChat(chatId, fields) {
  await pool.query(
    `INSERT INTO telegram_chats (chat_id, school_id, phone, name) VALUES ($1, $2, $3, $4)
     ON CONFLICT (chat_id) DO UPDATE SET
       school_id = COALESCE(EXCLUDED.school_id, telegram_chats.school_id),
       phone = COALESCE(EXCLUDED.phone, telegram_chats.phone),
       name = COALESCE(EXCLUDED.name, telegram_chats.name),
       updated_at = now()`,
    [chatId, fields.schoolId || null, fields.phone || null, fields.name || null]
  );
  return getChat(chatId);
}

async function findSchoolBySlug(slug) {
  const { rows } = await pool.query('SELECT id, name FROM schools WHERE slug = $1 AND active', [slug]);
  return rows[0] || null;
}

// Sem link de escola, só dá para seguir se existir uma única escola ativa
// (como era antes do multi-escola).
async function findOnlySchool() {
  const { rows } = await pool.query('SELECT id, name FROM schools WHERE active LIMIT 2');
  return rows.length === 1 ? rows[0] : null;
}

// Vincula o chat ao contato do telefone na lista da escola (cria o contato,
// sem opt-in, se ainda não existir — o opt-in continua explícito via ENTRAR).
async function linkContact(schoolId, chatId, phone, name) {
  await pool.query(
    'UPDATE contacts SET telegram_chat_id = NULL WHERE school_id = $1 AND telegram_chat_id = $2 AND phone <> $3',
    [schoolId, chatId, phone]
  );
  const { rows } = await pool.query(
    `INSERT INTO contacts (school_id, phone, name, opt_in, telegram_chat_id) VALUES ($1, $2, $3, false, $4)
     ON CONFLICT (school_id, phone) DO UPDATE SET telegram_chat_id = EXCLUDED.telegram_chat_id,
       name = COALESCE(contacts.name, EXCLUDED.name)
     RETURNING *`,
    [schoolId, phone, name, chatId]
  );
  return rows[0];
}

const ASK_SCHOOL_LINK =
  'Olá! Eu sou o EduBot, o assistente de oportunidades educacionais. Para começar, abra o link do EduBot divulgado pela sua escola.';

function askPhone(chatId, schoolName) {
  return sendMessage(
    chatId,
    `Olá! Eu sou o EduBot, o assistente de oportunidades educacionais da ${schoolName}. Para começar, toque em "Compartilhar meu número" abaixo.`,
    SHARE_CONTACT_KEYBOARD
  );
}

function linkedReply(contact, schoolName) {
  return contact.opt_in
    ? `Você está conversando com a ${schoolName} e já recebe os avisos de oportunidades. Envie MENU para ver as ativas.`
    : `Você está conversando com a ${schoolName}. Envie ENTRAR para receber os avisos de oportunidades educacionais da escola.`;
}

// /start <slug> — entrada pelo link de uma escola (ou troca de escola).
async function handleStart(msg, slug) {
  const chatId = msg.chat.id;
  const school = await findSchoolBySlug(slug);
  if (!school) {
    await sendMessage(chatId, 'Este link de escola não é válido. Peça à coordenação o link atualizado do EduBot.', {
      remove_keyboard: true,
    });
    return;
  }
  const chat = await saveChat(chatId, { schoolId: school.id, name: displayName(msg.from) });
  if (!chat.phone) {
    await askPhone(chatId, school.name);
    return;
  }
  const contact = await linkContact(school.id, chatId, chat.phone, chat.name);
  await sendMessage(chatId, linkedReply(contact, school.name));
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || msg.chat.type !== 'private') return; // grupos e canais ficam de fora
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : '';

  const startMatch = text.match(/^\/start(?:@\w+)?\s+([a-z0-9-]+)$/i);
  if (startMatch) {
    await handleStart(msg, startMatch[1].toLowerCase());
    return;
  }

  let chat = await getChat(chatId);
  if (!chat?.school_id || !chat.school_active) {
    const only = await findOnlySchool();
    if (!only) {
      await sendMessage(chatId, ASK_SCHOOL_LINK, { remove_keyboard: true });
      return;
    }
    chat = await saveChat(chatId, { schoolId: only.id, name: displayName(msg.from) });
  }

  if (msg.contact) {
    // Só aceita o próprio número — impede vincular o telefone de outra pessoa.
    if (msg.contact.user_id !== msg.from.id) {
      await sendMessage(chatId, 'Por segurança, compartilhe o seu próprio número pelo botão abaixo.', SHARE_CONTACT_KEYBOARD);
      return;
    }
    chat = await saveChat(chatId, { phone: normalizePhone(msg.contact.phone_number), name: displayName(msg.from) });
    const contact = await linkContact(chat.school_id, chatId, chat.phone, chat.name);
    await sendMessage(chatId, `Número vinculado! ${linkedReply(contact, chat.school_name)}`);
    return;
  }

  if (!text) return;
  if (!chat.phone) {
    await askPhone(chatId, chat.school_name);
    return;
  }

  // Garante o vínculo com a lista da escola atual (ex.: contato antigo,
  // anterior ao multi-escola, ou escola trocada por outro link).
  await linkContact(chat.school_id, chatId, chat.phone, chat.name);

  const command = text.toLowerCase() === '/start' ? 'MENU' : SLASH_COMMANDS[text.toLowerCase().split('@')[0]];
  const { reply } = await processInboundMessage({
    schoolId: chat.school_id,
    phone: chat.phone,
    name: chat.name,
    message: command || text,
    origin: 'telegram',
  });
  await sendMessage(chatId, reply);
}

// Nome de usuário do bot (@...), para montar o link de entrada de cada
// escola. Consultado uma vez (getMe) e guardado em memória.
let botUsernamePromise = null;

function getBotUsername() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !TOKEN_FORMAT.test(process.env.TELEGRAM_BOT_TOKEN)) {
    return Promise.resolve(null);
  }
  if (!botUsernamePromise) {
    botUsernamePromise = callTelegram('getMe', {})
      .then((me) => me.username || null)
      .catch((err) => {
        console.error('[telegram] não foi possível consultar o nome do bot:', redact(err.message));
        botUsernamePromise = null;
        return null;
      });
  }
  return botUsernamePromise;
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

module.exports = { startTelegramBot, handleUpdate, callTelegram, apiUrl, redact, getBotUsername };
