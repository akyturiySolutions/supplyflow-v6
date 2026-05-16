/**
 * Bot Dispatcher
 * Routes incoming WhatsApp messages to the correct conversation flow.
 * Supports: text, interactive (buttons/lists), and location messages.
 *
 * PATCHED:
 *  - _lastInput now correctly set from current message BEFORE routing
 *  - MAIN_MENU routes immediately on button press (no second-message needed)
 *  - BROWSING no longer double-renders catalogue on first ADD_ input
 *  - TYPING_ADDRESS wired into the routing switch
 */

const { sendMessage, sendInteractive, markRead } = require('./whatsapp');
const { getSession, setSession, clearSession }   = require('./session');
const { getBusinessConfig }                       = require('../db/firestore');
const orderFlow   = require('./flows/orderFlow');
const trackFlow   = require('./flows/trackFlow');
const supportFlow = require('./flows/supportFlow');

/**
 * Entry point called by server.js for every incoming message.
 */
async function handleIncomingMessage(msg, metadata, contact) {
  const from    = msg.from;
  const phoneId = metadata.phone_number_id;
  const name    = contact?.profile?.name || 'Customer';
  const bizId   = phoneId;

  // Mark as read (fire-and-forget — don't block on failure)
  markRead(phoneId, msg.id).catch(() => {});

  // Load business config
  const biz = await getBusinessConfig(bizId);

  // Load or create session
  let session = await getSession(from);
  if (!session) {
    session = { from, name, bizId, step: 'MAIN_MENU', cart: [], createdAt: Date.now() };
  }

  // ── Extract message content ──────────────────────────────────
  const { type } = msg;
  let text   = '';
  let btnId  = '';
  let listId = '';

  if (type === 'text') {
    text = (msg.text?.body || '').trim();
  } else if (type === 'interactive') {
    const ia = msg.interactive;
    if (ia.type === 'button_reply') btnId = ia.button_reply.id;
    if (ia.type === 'list_reply')   listId = ia.list_reply.id;
  } else if (type === 'location') {
    // Attach location to session so flows can read it
    session = { ...session, location: msg.location };
  }

  // FIX: _lastInput is the CURRENT message's input — set it here, not inside showMainMenu
  const input = btnId || listId || text;
  session = { ...session, _lastInput: input };

  console.log(`[Bot] ${from} | step=${session.step} | input="${input.slice(0, 60)}"`);

  // ── Global reset commands (work from any step) ───────────────
  const lower = text.toLowerCase();
  if (['menu', 'hi', 'hei', 'hello', 'start', '0', 'back', 'cancel'].includes(lower)) {
    session = { ...session, step: 'MAIN_MENU', cart: [] };
  }

  // ── Rate limiting (simple per-number, in-memory) ─────────────
  if (isRateLimited(from)) {
    await sendMessage(phoneId, from, '⏳ Please slow down — send one message at a time.');
    return;
  }

  // ── Route by step ────────────────────────────────────────────
  let nextSession = session;

  try {
    switch (session.step) {

      // FIX: MAIN_MENU now acts immediately on the current input
      case 'MAIN_MENU':
        nextSession = await handleMainMenu(phoneId, session, input, biz);
        break;

      // FIX: BROWSING and TYPING_ADDRESS explicitly separated
      case 'BROWSING':
      case 'ADD_TO_CART':
      case 'CART_REVIEW':
      case 'DELIVERY_DETAILS':
      case 'TYPING_ADDRESS':        // ← was missing from switch
      case 'PAYMENT_CHOICE':
      case 'AWAITING_PAYMENT':
      case 'ORDER_CONFIRM':
        nextSession = await orderFlow.handle(phoneId, session, input, biz);
        break;

      case 'TRACKING':
        nextSession = await trackFlow.handle(phoneId, session, input, biz);
        break;

      case 'SUPPORT':
        nextSession = await supportFlow.handle(phoneId, session, input, biz);
        break;

      default:
        nextSession = await handleMainMenu(phoneId, session, '', biz);
    }
  } catch (err) {
    console.error(`[Dispatcher] Unhandled error for ${from}:`, err);
    await sendMessage(phoneId, from,
      '⚠️ Something went wrong on our end. Please try again or type *menu* to restart.');
    nextSession = { ...session, step: 'MAIN_MENU' };
  }

  await setSession(from, nextSession);
}

// ── Main Menu ────────────────────────────────────────────────────
// FIX: takes `input` as a parameter — no longer reads stale session._lastInput
async function handleMainMenu(phoneId, session, input, biz) {
  // If the customer pressed a menu button, route immediately — no second message needed
  if (input === 'ORDER')   return { ...session, step: 'BROWSING'  };
  if (input === 'TRACK')   return { ...session, step: 'TRACKING'  };
  if (input === 'SUPPORT') return { ...session, step: 'SUPPORT'   };

  // Otherwise show the menu
  const bizName  = biz?.name    || 'SupplyFlow';
  const greeting = biz?.greeting || `Welcome to *${bizName}*! 🏪\nHow can we help you today?`;

  await sendInteractive(phoneId, session.from, {
    type: 'button',
    body: { text: `${greeting}\n\nReply *menu* at any time to restart.` },
    action: {
      buttons: [
        { type: 'reply', reply: { id: 'ORDER',   title: '🛒 Place Order' } },
        { type: 'reply', reply: { id: 'TRACK',   title: '📦 Track Order' } },
        { type: 'reply', reply: { id: 'SUPPORT', title: '💬 Support'     } },
      ]
    }
  });

  return { ...session, step: 'MAIN_MENU' };
}

// ── Simple rate limiter (max 3 msgs / 2 seconds per number) ─────
const _rateBuckets = new Map();
function isRateLimited(from) {
  const now    = Date.now();
  const window = 2000;
  const max    = 3;
  const hits   = (_rateBuckets.get(from) || []).filter(t => now - t < window);
  hits.push(now);
  _rateBuckets.set(from, hits);
  if (_rateBuckets.size > 5000) {
    // Prevent unbounded growth
    const oldest = [..._rateBuckets.entries()].sort((a, b) => a[1][0] - b[1][0]);
    oldest.slice(0, 1000).forEach(([k]) => _rateBuckets.delete(k));
  }
  return hits.length > max;
}

module.exports = { handleIncomingMessage };
