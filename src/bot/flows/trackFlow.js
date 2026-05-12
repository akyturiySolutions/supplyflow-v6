/**
 * Track Flow — lets customers check their order status
 */

const { sendMessage, sendInteractive } = require('../whatsapp');
const { getOrder } = require('../../db/firestore');

async function handle(phoneId, session, input, biz) {
  if (session.step === 'TRACKING' && !session._askedOrderId) {
    await sendMessage(phoneId, session.from,
      '📦 *Order Tracking*\n\nPlease enter your Order ID (e.g. ORD-20240427-1234):');
    return { ...session, step: 'TRACKING', _askedOrderId: true };
  }

  // They typed an order ID
  const orderId = input.toUpperCase().trim();
  if (orderId.length < 5) {
    await sendMessage(phoneId, session.from,
      '⚠️ Please enter a valid Order ID. It looks like: ORD-20240427-1234');
    return session;
  }

  try {
    const order = await getOrder(orderId);
    if (!order) {
      await sendMessage(phoneId, session.from,
        `❌ Order *${orderId}* not found.\n\nDouble-check the ID or reply *menu* to go back.`);
      return session;
    }

    const statusEmoji = {
      PENDING_PAYMENT: '⏳',
      PAID:            '✅',
      CONFIRMED_COD:   '✅',
      PROCESSING:      '🔄',
      DISPATCHED:      '🚚',
      DELIVERED:       '🎉',
      CANCELLED:       '❌',
    };

    const emoji = statusEmoji[order.status] || '📦';
    const items = (order.cart || []).map(i => `• ${i.name} × ${i.qty}`).join('\n');

    await sendInteractive(phoneId, session.from, {
      type: 'button',
      body: {
        text:
          `${emoji} *Order ${orderId}*\n\n` +
          `Status: *${order.status.replace(/_/g, ' ')}*\n` +
          `Items:\n${items}\n` +
          `Address: ${order.deliveryAddress || 'N/A'}\n` +
          `Total: KES ${order.total || 0}\n` +
          (order.driverPhone ? `\nDriver: wa.me/${order.driverPhone}` : '')
      },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'TRACK_ANOTHER', title: '🔍 Track Another' } },
          { type: 'reply', reply: { id: 'SUPPORT',       title: '💬 Get Help'      } },
        ]
      }
    });

    if (input === 'TRACK_ANOTHER') return { ...session, step: 'TRACKING', _askedOrderId: false };
    if (input === 'SUPPORT')       return { ...session, step: 'SUPPORT' };

    return { ...session, step: 'MAIN_MENU' };
  } catch (err) {
    console.error('[TrackFlow]', err);
    await sendMessage(phoneId, session.from,
      '⚠️ Could not retrieve order details. Please try again or contact support.');
    return { ...session, step: 'MAIN_MENU' };
  }
}

module.exports = { handle };
