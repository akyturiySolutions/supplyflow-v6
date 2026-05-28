/**
 * orderFlow.js - Clean rewrite
 * Simple linear flow - no loops, no complexity
 */

const { sendMessage, sendInteractive } = require('../whatsapp');
const { saveOrder, updateOrderStatus } = require('../../db/firestore');
const { generateOrderId, formatKES }   = require('../../utils/helpers');

async function handle(phoneId, session, input, biz) {
  var step = session.step;

  console.log('[OrderFlow] step=' + step + ' input=' + input.slice(0,40));

  /* ══════════════════════════════════════════
     BROWSING — show category or product list
  ══════════════════════════════════════════ */
  if (step === 'BROWSING') {

    if (input.startsWith('ADD_')) {
      return doAddToCart(phoneId, session, input, biz);
    }

    if (input.startsWith('CAT_')) {
      return doCategoryItems(phoneId, session, input, biz);
    }

    var isCat = biz.menuMode === 'categorised' && Array.isArray(biz.categories);

    if (isCat) {
      var catRows = biz.categories.map(function(c) {
        var cnt = biz.products.filter(function(p) { return p.category === c.id; }).length;
        return { id: 'CAT_' + c.id, title: c.name.slice(0,24), description: cnt + ' items' };
      });
      await sendInteractive(phoneId, session.from, {
        type: 'list',
        body: { text: '*' + (biz.name||'Menu') + '*\n\nChoose a category:' },
        footer: { text: 'Type menu to go back' },
        action: { button: 'View Menu', sections: [{ title: 'Categories', rows: catRows }] }
      });
    } else {
      var prods = (biz.products || getDefaults(biz.sector)).slice(0,9);
      var pRows = prods.map(function(p) {
        return { id: 'ADD_' + p.id, title: p.name.slice(0,24), description: (formatKES(p.price) + ' - ' + (p.description||'')).slice(0,72) };
      });
      await sendInteractive(phoneId, session.from, {
        type: 'list',
        body: { text: '*' + (biz.name||'Products') + '*\n\nSelect a product:' },
        footer: { text: 'Type menu to go back' },
        action: { button: 'View Products', sections: [{ title: 'Products', rows: pRows }] }
      });
    }

    return Object.assign({}, session, { step: 'BROWSING' });
  }

  /* ══════════════════════════════════════════
     CATEGORY_ITEMS — show items in category
  ══════════════════════════════════════════ */
  if (step === 'CATEGORY_ITEMS') {
    if (input.startsWith('ADD_')) return doAddToCart(phoneId, session, input, biz);
    if (input.startsWith('CAT_')) return doCategoryItems(phoneId, session, input, biz);
    if (input.startsWith('MORE_')) return doMoreItems(phoneId, session, input, biz);
    return handle(phoneId, Object.assign({}, session, { step: 'BROWSING' }), '', biz);
  }

  /* ══════════════════════════════════════════
     ADD_TO_CART — choose quantity
  ══════════════════════════════════════════ */
  if (step === 'ADD_TO_CART') {
    return doAddToCart(phoneId, session, input, biz);
  }

  /* ══════════════════════════════════════════
     CART_REVIEW — show cart
  ══════════════════════════════════════════ */
  if (step === 'CART_REVIEW') {

    // Handle quantity selection from previous step
    if (input.startsWith('QTY_')) {
      var parts = input.split('_');
      var qty   = parseInt(parts[parts.length-1], 10);
      var pid   = parts.slice(1,-1).join('_');
      var allP  = biz.products || getDefaults(biz.sector);
      var prod  = allP.find(function(p){ return p.id === pid; });
      if (prod && qty > 0) {
        var cart = (session.cart||[]).slice();
        var idx  = -1;
        for (var i=0; i<cart.length; i++) { if (cart[i].productId===pid) { idx=i; break; } }
        if (idx >= 0) {
          cart[idx] = Object.assign({}, cart[idx], { qty: cart[idx].qty + qty });
        } else {
          cart.push({ productId: pid, name: prod.name, qty: qty, unitPrice: prod.price });
        }
        session = Object.assign({}, session, { cart: cart });
      }
    }

    // ── Handle cart action buttons ──────────────────
    // GO TO PAYMENT — ask for address directly
    if (input === 'CHECKOUT') {
      console.log('[OrderFlow] CHECKOUT -> asking for address');
      await sendMessage(phoneId, session.from,
        'Where should we deliver your order?\n\n' +
        'Please type your delivery address:\n' +
        '(e.g. Kerugoya stage, Land offices, ABC building)'
      );
      return Object.assign({}, session, { step: 'TYPING_ADDRESS' });
    }

    if (input === 'ADD_MORE') {
      return handle(phoneId, Object.assign({}, session, { step: 'BROWSING' }), '', biz);
    }

    if (input === 'CLEAR_CART') {
      return handle(phoneId, Object.assign({}, session, { cart: [], step: 'BROWSING' }), '', biz);
    }

    // ── Show cart ────────────────────────────────────
    var cart2 = session.cart || [];
    if (cart2.length === 0) {
      await sendMessage(phoneId, session.from, 'Your cart is empty. Let\'s add something!');
      return handle(phoneId, Object.assign({}, session, { step: 'BROWSING' }), '', biz);
    }

    var total    = cart2.reduce(function(s,i){ return s + i.qty*i.unitPrice; }, 0);
    var cartText = cart2.map(function(i){ return '- ' + i.name + ' x' + i.qty + ' = ' + formatKES(i.qty*i.unitPrice); }).join('\n');

    await sendInteractive(phoneId, session.from, {
      type: 'button',
      body: { text: '*Your Order*\n\n' + cartText + '\n\n*Total: ' + formatKES(total) + '*' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'CHECKOUT',   title: 'Go to Payment' } },
          { type: 'reply', reply: { id: 'ADD_MORE',   title: 'Add More'      } },
          { type: 'reply', reply: { id: 'CLEAR_CART', title: 'Clear Cart'    } },
        ]
      }
    });

    return Object.assign({}, session, { step: 'CART_REVIEW' });
  }

  /* ══════════════════════════════════════════
     TYPING_ADDRESS — customer types address
  ══════════════════════════════════════════ */
  if (step === 'TYPING_ADDRESS') {

    // Reject any button IDs that arrive here
    var isBtn = (input === 'CHECKOUT' || input === 'ADD_MORE' || input === 'CLEAR_CART' ||
                 input === 'PAY_MPESA_MANUAL' || input === 'PAY_COD' ||
                 input.startsWith('CAT_') || input.startsWith('ADD_') ||
                 input.startsWith('QTY_') || input.startsWith('MORE_'));

    if (isBtn || input.trim().length < 2) {
      await sendMessage(phoneId, session.from,
        'Please type your delivery address:\n(e.g. Kerugoya stage, ABC building, Land offices)'
      );
      return Object.assign({}, session, { step: 'TYPING_ADDRESS' });
    }

    // Valid address received — go straight to payment
    var addr = input.trim().slice(0, 200);
    console.log('[OrderFlow] Address received: ' + addr + ' -> PAYMENT_CHOICE');

    var total2   = (session.cart||[]).reduce(function(s,i){ return s+i.qty*i.unitPrice; },0);
    var tillNum  = biz.mpesaTill || process.env.MPESA_TILL || '5214133';

    await sendInteractive(phoneId, session.from, {
      type: 'button',
      body: { text: '*How would you like to pay?*\n\nOrder Total: *' + formatKES(total2) + '*\nDeliver to: ' + addr },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'PAY_MPESA_MANUAL', title: 'Pay via M-Pesa'  } },
          { type: 'reply', reply: { id: 'PAY_COD',          title: 'Pay on Delivery' } },
        ]
      }
    });

    return Object.assign({}, session, { pendingAddr: addr, step: 'PAYMENT_CHOICE' });
  }

  /* ══════════════════════════════════════════
     PAYMENT_CHOICE — handle payment selection
  ══════════════════════════════════════════ */
  if (step === 'PAYMENT_CHOICE') {

    var payTotal = (session.cart||[]).reduce(function(s,i){ return s+i.qty*i.unitPrice; },0);
    var till     = biz.mpesaTill || process.env.MPESA_TILL || '5214133';
    var orderId  = generateOrderId();

    if (input === 'PAY_MPESA_MANUAL') {
      await sendMessage(phoneId, session.from,
        'Order *' + orderId + '* placed! \u2705\n\n' +
        'Please pay *' + formatKES(payTotal) + '* via M-Pesa:\n' +
        'Till Number: *' + till + '*\n' +
        'Account Ref: *' + orderId + '*\n\n' +
        'After paying, send your M-Pesa confirmation code here.\n' +
        '(e.g. QGH3K7XZZZ)\n\n' +
        'Reply *menu* to cancel.'
      );
      await saveOrder({ orderId: orderId, session: session, total: payTotal, status: 'PENDING_PAYMENT', biz: biz });
      return Object.assign({}, session, { step: 'AWAITING_PAYMENT', orderId: orderId });
    }

    if (input === 'PAY_COD') {
      await sendMessage(phoneId, session.from,
        'Order *' + orderId + '* confirmed! \uD83C\uDF89\n\n' +
        '\uD83D\uDE9A Delivering to: ' + (session.pendingAddr||'N/A') + '\n' +
        '\uD83D\uDCB5 Pay *' + formatKES(payTotal) + '* on delivery.\n\n' +
        'We will be with you shortly!\n' +
        'Track: reply *menu* \u2192 *Track Order* \u2192 *' + orderId + '*'
      );
      await saveOrder({ orderId: orderId, session: session, total: payTotal, status: 'CONFIRMED_COD', biz: biz });
      return Object.assign({}, session, { step: 'MAIN_MENU', cart: [], orderId: null });
    }

    // Button not yet tapped — show payment options
    await sendInteractive(phoneId, session.from, {
      type: 'button',
      body: { text: '*How would you like to pay?*\n\nOrder Total: *' + formatKES(payTotal) + '*\nDeliver to: ' + (session.pendingAddr||'N/A') },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'PAY_MPESA_MANUAL', title: 'Pay via M-Pesa'  } },
          { type: 'reply', reply: { id: 'PAY_COD',          title: 'Pay on Delivery' } },
        ]
      }
    });
    return Object.assign({}, session, { step: 'PAYMENT_CHOICE' });
  }

  /* ══════════════════════════════════════════
     AWAITING_PAYMENT — wait for M-Pesa code
  ══════════════════════════════════════════ */
  if (step === 'AWAITING_PAYMENT') {
    var code = input.toUpperCase().replace(/\s/g,'');
    if (/^[A-Z0-9]{10}$/.test(code)) {
      await sendMessage(phoneId, session.from,
        'Payment confirmed! \u2705\n\n' +
        'M-Pesa Code: *' + code + '*\n' +
        'Order *' + session.orderId + '* is being prepared. \uD83C\uDF7D\uFE0F\n\n' +
        'We will notify you when it is on the way!'
      );
      await updateOrderStatus(session.orderId, 'PAID', { mpesaCode: code });
      return Object.assign({}, session, { step: 'MAIN_MENU', cart: [] });
    }
    if (input.length > 0) {
      await sendMessage(phoneId, session.from,
        'Waiting for your M-Pesa code.\n\nSend the 10-character code (e.g. QGH3K7XZZZ).\nReply *menu* to cancel.'
      );
    }
    return session;
  }

  // Default fallback
  return Object.assign({}, session, { step: 'MAIN_MENU' });
}

/* ── Helper functions ─────────────────────────────────────── */

async function doCategoryItems(phoneId, session, input, biz) {
  var catId    = input.replace('CAT_','');
  var category = biz.categories.find(function(c){ return c.id===catId; });
  var items    = biz.products.filter(function(p){ return p.category===catId; });

  if (!items.length) {
    await sendMessage(phoneId, session.from, 'No items in this category. Choose another.');
    return handle(phoneId, Object.assign({}, session, { step: 'BROWSING' }), '', biz);
  }

  var rows = items.slice(0,9).map(function(p){
    return { id: 'ADD_'+p.id, title: p.name.slice(0,24), description: (formatKES(p.price)+' - '+(p.description||'')).slice(0,72) };
  });

  if (items.length > 9) {
    rows.push({ id: 'MORE_'+catId+'_0', title: 'See More Items', description: (items.length-9)+' more items' });
  }

  await sendInteractive(phoneId, session.from, {
    type: 'list',
    body: { text: (category?category.name:catId) + '\n\nSelect an item:' },
    footer: { text: 'Type menu to restart' },
    action: { button: 'Choose Item', sections: [{ title: category?category.name:'Items', rows: rows }] }
  });

  return Object.assign({}, session, { step: 'CATEGORY_ITEMS', _currentCat: catId });
}

async function doMoreItems(phoneId, session, input, biz) {
  var parts   = input.split('_');
  var page    = parseInt(parts[parts.length-1],10)||0;
  var catId   = parts.slice(1,-1).join('_');
  var items   = biz.products.filter(function(p){ return p.category===catId; });
  var start   = 9 + page*9;
  var rows    = items.slice(start, start+9).map(function(p){
    return { id: 'ADD_'+p.id, title: p.name.slice(0,24), description: (formatKES(p.price)+' - '+(p.description||'')).slice(0,72) };
  });
  if (items.length > start+9) {
    rows.push({ id: 'MORE_'+catId+'_'+(page+1), title: 'See More Items', description: (items.length-start-9)+' more' });
  }
  await sendInteractive(phoneId, session.from, {
    type: 'list',
    body: { text: 'More items:' },
    footer: { text: 'Type menu to restart' },
    action: { button: 'Choose Item', sections: [{ title: 'More Items', rows: rows }] }
  });
  return Object.assign({}, session, { step: 'CATEGORY_ITEMS', _currentCat: catId });
}

async function doAddToCart(phoneId, session, input, biz) {
  var pid   = input.replace('ADD_','');
  var allP  = biz.products || getDefaults(biz.sector);
  var prod  = allP.find(function(p){ return p.id===pid; });

  if (!prod) {
    await sendMessage(phoneId, session.from, 'Item not found. Please try again.');
    return handle(phoneId, Object.assign({}, session, { step: 'BROWSING' }), '', biz);
  }

  await sendInteractive(phoneId, session.from, {
    type: 'button',
    body: { text: '*' + prod.name + '*\n' + formatKES(prod.price) + '\n' + (prod.description||'') + '\n\nHow many?' },
    action: {
      buttons: [
        { type: 'reply', reply: { id: 'QTY_'+pid+'_1', title: '1' } },
        { type: 'reply', reply: { id: 'QTY_'+pid+'_2', title: '2' } },
        { type: 'reply', reply: { id: 'QTY_'+pid+'_3', title: '3' } },
      ]
    }
  });

  return Object.assign({}, session, { step: 'CART_REVIEW' });
}

function getDefaults(sector) {
  var c = {
    water: [
      { id:'w5',  name:'5L Bottle',       price:50,   description:'Purified spring water' },
      { id:'w10', name:'10L Jerry Can',    price:80,   description:'Refillable container'  },
      { id:'w20', name:'20L Dispenser',    price:150,  description:'Home and office use'   },
      { id:'wmo', name:'Monthly Plan 20L', price:2500, description:'20 deliveries/month'   },
    ],
    gas: [
      { id:'g6',  name:'6kg LPG',         price:1500, description:'Home cooking gas'  },
      { id:'g13', name:'13kg LPG',         price:2800, description:'Large household'   },
      { id:'g35', name:'35kg Commercial',  price:6500, description:'Restaurant/hotel'  },
    ],
    milk: [
      { id:'m1',  name:'500ml Fresh Milk', price:50,  description:'Pasteurized milk'   },
      { id:'m2',  name:'1L Fresh Milk',    price:90,  description:'Daily litre'        },
    ],
    retail: [
      { id:'r1',  name:'Product A', price:100, description:'Add via admin panel' },
      { id:'r2',  name:'Product B', price:250, description:'Add via admin panel' },
    ],
  };
  return c[sector] || c.water;
}

module.exports = { handle: handle };
