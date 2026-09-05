const pool = require('../db/pool');
const { classifyStatus } = require('../utils/classifyStatus');

const COMMANDS = {
  OPT_IN: ['ENTRAR', 'INICIAR', 'START'],
  OPT_OUT: ['SAIR', 'PARAR', 'STOP'],
  MENU: ['MENU'],
  HUMAN: ['ATENDENTE', 'HUMANO', 'FALAR COM ALGUEM', 'FALAR COM ALGUÉM'],
};

async function findOrCreateContact(phone, name) {
  const { rows } = await pool.query('SELECT * FROM contacts WHERE phone = $1', [phone]);
  if (rows[0]) return rows[0];

  const { rows: created } = await pool.query(
    `INSERT INTO contacts (phone, name, opt_in) VALUES ($1, $2, false) RETURNING *`,
    [phone, name || null]
  );
  return created[0];
}

async function registerConsent(contactId, type) {
  await pool.query(
    'INSERT INTO consent_logs (contact_id, type, origin) VALUES ($1, $2, $3)',
    [contactId, type, 'whatsapp']
  );
}

async function getActiveOpportunities() {
  const { rows } = await pool.query('SELECT * FROM opportunities WHERE is_draft = false ORDER BY created_at DESC');
  return rows.map((row) => ({ ...row, status: classifyStatus(row) })).filter((o) => o.status === 'Ativa');
}

function buildMenuReply(activeOpportunities) {
  if (activeOpportunities.length === 0) {
    return 'No momento não há oportunidades ativas. Assim que surgir uma novidade, você será avisado por aqui.';
  }
  const list = activeOpportunities
    .slice(0, 10)
    .map((o) => `• ${o.title}`)
    .join('\n');
  return [
    'Oportunidades ativas:',
    list,
    '',
    'Envie o nome (ou parte do nome) de uma oportunidade para saber mais, ATENDENTE para falar com a coordenação, ou SAIR para deixar de receber notificações.',
  ].join('\n');
}

function buildOpportunityDetailReply(opportunity) {
  const deadline = new Date(opportunity.deadline).toLocaleDateString('pt-BR');
  const lines = [
    opportunity.title,
    opportunity.description,
    `Público-alvo: ${opportunity.target_audience}`,
    `Inscrições até ${deadline}`,
  ];
  if (opportunity.link) lines.push(`Saiba mais: ${opportunity.link}`);
  return lines.join('\n');
}

function matchCommand(message) {
  const normalized = message.trim().toUpperCase();
  for (const [command, aliases] of Object.entries(COMMANDS)) {
    if (aliases.includes(normalized)) return command;
  }
  return null;
}

// RF-07 — resolução autônoma: casa o texto recebido com o título de alguma
// oportunidade ativa. É um casamento simples por substring (sem NLP/intenção),
// suficiente para o escopo do MVP e para o tempo de resposta do RNF-01.
async function matchOpportunityByTitle(message, activeOpportunities) {
  const term = message.trim().toLowerCase();
  if (term.length < 3) return null;
  return activeOpportunities.find((o) => o.title.toLowerCase().includes(term)) || null;
}

// RF-07 a RF-11 — webhook chamado pelo workflow do N8N a cada mensagem
// recebida via WAHA. Aplica o fluxo conversacional (opt-in/opt-out, menu,
// FAQ e encaminhamento humano) e devolve o texto que o N8N deve reenviar
// ao contato pelo WAHA.
async function handleInboundMessage(req, res, next) {
  try {
    const { phone, name, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'Informe phone e message.' });
    }

    const contact = await findOrCreateContact(phone, name);
    const command = matchCommand(message);

    if (command === 'OPT_IN') {
      if (!contact.opt_in) {
        await pool.query('UPDATE contacts SET opt_in = true WHERE id = $1', [contact.id]);
        await registerConsent(contact.id, 'opt_in');
      }
      return res.json({
        reply:
          'Você está inscrito para receber novidades de oportunidades educacionais. Envie MENU a qualquer momento para ver as ativas, ou SAIR para cancelar.',
      });
    }

    if (command === 'OPT_OUT') {
      if (contact.opt_in) {
        await pool.query('UPDATE contacts SET opt_in = false WHERE id = $1', [contact.id]);
      }
      await registerConsent(contact.id, 'opt_out');
      return res.json({
        reply: 'Você não receberá mais notificações. Envie ENTRAR a qualquer momento para voltar a receber.',
      });
    }

    if (!contact.opt_in) {
      return res.json({
        reply:
          'Olá! Para receber avisos de oportunidades educacionais, envie ENTRAR. Você pode cancelar quando quiser enviando SAIR.',
      });
    }

    const activeOpportunities = await getActiveOpportunities();

    if (command === 'MENU') {
      return res.json({ reply: buildMenuReply(activeOpportunities) });
    }

    if (command === 'HUMAN') {
      await pool.query(
        'INSERT INTO support_requests (contact_id, message) VALUES ($1, $2)',
        [contact.id, message]
      );
      return res.json({
        reply: 'Encaminhamos sua solicitação para a coordenação da escola. Em breve alguém vai te responder por aqui.',
      });
    }

    const matched = await matchOpportunityByTitle(message, activeOpportunities);
    if (matched) {
      return res.json({ reply: buildOpportunityDetailReply(matched) });
    }

    // RF-09 — o fluxo automático não resolveu: encaminha para atendimento
    // humano e registra a solicitação.
    await pool.query(
      'INSERT INTO support_requests (contact_id, message) VALUES ($1, $2)',
      [contact.id, message]
    );
    return res.json({
      reply:
        'Não encontrei essa informação automaticamente. Encaminhei sua dúvida para a coordenação da escola — em breve alguém responde por aqui. Envie MENU para ver as oportunidades ativas.',
    });
  } catch (err) {
    return next(err);
  }
}

// Consulta administrativa da fila de atendimento humano (RF-09).
async function listSupportRequests(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT sr.id, sr.message, sr.status, sr.created_at,
              c.id AS contact_id, c.name AS contact_name, c.phone AS contact_phone
       FROM support_requests sr
       JOIN contacts c ON c.id = sr.contact_id
       ORDER BY sr.created_at DESC`
    );

    return res.json({
      items: rows.map((row) => ({
        id: row.id,
        message: row.message,
        status: row.status,
        createdAt: row.created_at,
        contact: { id: row.contact_id, name: row.contact_name, phone: row.contact_phone },
      })),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { handleInboundMessage, listSupportRequests };
