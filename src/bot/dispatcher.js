/**
 * Bot Dispatcher - V6.1 Final
 */

const { sendMessage, sendInteractive, markRead } = require('./whatsapp');
const { getSession, setSession }                 = require('./session');
const { getBusinessConfig }                      = require('../db/firestore');
const orderFlow   = require('./flows/orderFlow');
const trackFlow   = require('./flows/trackFlow');
const supportFlow = require('./flows/supportFlow');

async function handleIncomingMessage(msg, metadata, contact) {
  const from    = msg.from;
  const phoneId = metadata.phone_number_id;
  const name    = contact?.profile?.name || 'Customer';
  const bizId   = phoneId;

  markRead(phoneId, msg.id).catch(() => {});

  const biz = await getBusinessConfig(bizId);

  let session = await getSession(from);
  if (!session) {
    session = { from, name, bizId, step: 'MAIN_MENU', cart: [], createdAt: Date.now() };
  }

  const { type } = msg;
  let text = '', btnId = '', listId = '';

  if (type === 'text') {
    text = (msg.text?.body || '').trim();
  } else if (type === 'interactive') {
    const ia = msg.interactive;
    if (ia.type === 'button_reply') btnId  = ia.button_reply.id;
    if (ia.type === 'list_reply')   listId = ia.list_reply.id;
  } else if (type === 'location') {
    session = { ...session, location: msg.location };
  }

  const input = btnId || listId || text;
  session = { ...session, _lastInput: input };

  console.log('[Bot]', from, '| step=' + session.step, '| input="' + input.slice(0, 60) + '"');

  // Global reset commands
  const lower = text.toLowerCase();
  if (['menu','hi','hei','hello','start','0','back','cancel'].includes(lower)) {
    session = { ...session, step: 'MAIN_MENU', cart: [] };
  }

  // Rate limiter
  if (isRateLimited(from)) {
    await sendMessage(phoneId, from, 'Please slow down — one message at a time.');
    return;
  }

  let nextSession = session;
  try {
    switch (session.step) {
      case 'MAIN_MENU':
        nextSession = await handleMainMenu(phoneId, session, input, biz);
        break;
      case 'BROWSING':
      case 'CATEGORY_ITEMS':
      case 'ADD_TO_CART':
      case 'CHOOSE_SIDE':
      case 'CART_REVIEW':
      case 'DELIVERY_DETAILS':
      case 'TYPING_ADDRESS':
      case 'PAYMENT_CHOICE':
      case 'AWAITING_PAYMENT':
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
    console.error('[Dispatcher] Error for', from, ':', err.message);
    await sendMessage(phoneId, from, 'Something went wrong. Type menu to restart.');
    nextSession = { ...session, step: 'MAIN_MENU' };
  }

  await setSession(from, nextSession);
}

async function handleMainMenu(phoneId, session, input, biz) {
  // Route immediately on button press and show the screen
  if (input === 'ORDER') {
    const next = { ...session, step: 'BROWSING' };
    return await orderFlow.handle(phoneId, next, '', biz);
  }
  if (input === 'TRACK') {
    const next = { ...session, step: 'TRACKING' };
    return await trackFlow.handle(phoneId, next, '', biz);
  }
  if (input === 'SUPPORT') {
    const next = { ...session, step: 'SUPPORT' };
    return await supportFlow.handle(phoneId, next, '', biz);
  }

  // Show main menu
  const bizName  = biz?.name || 'SupplyFlow';
  const greeting = biz?.greeting || ('Welcome to *' + bizName + '*! How can we help you today?');

  await sendInteractive(phoneId, session.from, {
    type: 'button',
    body: { text: greeting + '\n\nReply *menu* anytime to restart.' },
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

// Rate limiter
const _rateBuckets = new Map();
function isRateLimited(from) {
  const now = Date.now(), window = 2000, max = 3;
  const hits = (_rateBuckets.get(from) || []).filter(function(t) { return now - t < window; });
  hits.push(now);
  _rateBuckets.set(from, hits);
  if (_rateBuckets.size > 5000) {
    var oldest = [];
    _rateBuckets.forEach(function(v, k) { oldest.push([k, v[0]]); });
    oldest.sort(function(a,b){ return a[1]-b[1]; }).slice(0,1000).forEach(function(x){ _rateBuckets.delete(x[0]); });
  }
  return hits.length > max;
}

module.exports = { handleIncomingMessage };
