/**
 * Support Flow — FAQs, escalation to human agent
 */

const { sendMessage, sendInteractive } = require('../whatsapp');

async function handle(phoneId, session, input, biz) {
  const supportPhone = biz?.supportPhone || process.env.SUPPORT_PHONE;

  await sendInteractive(phoneId, session.from, {
    type: 'list',
    body: { text: '💬 *Support Centre*\n\nHow can we help you?' },
    footer: { text: 'Reply *menu* to go back' },
    action: {
      button: 'Choose Topic',
      sections: [{
        title: 'Common Questions',
        rows: [
          { id: 'FAQ_DELIVERY', title: '🚚 Delivery Times',    description: 'When will I get my order?' },
          { id: 'FAQ_PAYMENT',  title: '💳 Payment Issues',   description: 'M-Pesa & billing help'     },
          { id: 'FAQ_RETURN',   title: '↩️ Returns / Refunds', description: 'How to return an order'   },
          { id: 'FAQ_CHANGE',   title: '✏️ Change Order',      description: 'Modify a pending order'   },
          { id: 'AGENT',        title: '🧑 Talk to Human',    description: 'Connect to a live agent'   },
        ]
      }]
    }
  });

  switch (input) {
    case 'FAQ_DELIVERY':
      await sendMessage(phoneId, session.from,
        '🚚 *Delivery Times*\n\n' +
        '• Same-day: Orders before 12PM\n' +
        '• Next-day: Orders after 12PM\n' +
        '• Express: 2-4 hours (extra charge)\n\n' +
        'You\'ll get a WhatsApp update when your order is dispatched.\n\nReply *menu* to go back.'
      );
      break;
    case 'FAQ_PAYMENT':
      await sendMessage(phoneId, session.from,
        '💳 *Payment Help*\n\n' +
        '• M-Pesa: send your code after paying\n' +
        '• Wrong amount paid: message us with proof\n' +
        '• Refunds: 3–5 business days to M-Pesa\n\n' +
        `Still stuck? WhatsApp our billing team: wa.me/${supportPhone}\n\nReply *menu* to go back.`
      );
      break;
    case 'FAQ_RETURN':
      await sendMessage(phoneId, session.from,
        '↩️ *Returns & Refunds*\n\n' +
        '• Contact us within 24h of delivery\n' +
        '• Send a photo of the issue\n' +
        '• Refund or replacement within 48h\n\n' +
        `WhatsApp us: wa.me/${supportPhone}\n\nReply *menu* to go back.`
      );
      break;
    case 'FAQ_CHANGE':
      await sendMessage(phoneId, session.from,
        '✏️ *Change / Cancel Order*\n\n' +
        '• Changes allowed within 30 minutes of placing order\n' +
        '• Once dispatched: no changes possible\n\n' +
        `Contact us now: wa.me/${supportPhone}\n\nInclude your Order ID.\n\nReply *menu* to go back.`
      );
      break;
    case 'AGENT':
      await sendMessage(phoneId, session.from,
        `🧑 *Live Support*\n\nConnecting you to a human agent...\n\n` +
        `📲 WhatsApp: wa.me/${supportPhone}\n` +
        `⏰ Available: Mon–Sat 8AM–8PM\n\n` +
        `Reply *menu* to go back.`
      );
      break;
  }

  return { ...session, step: 'SUPPORT' };
}

module.exports = { handle };
