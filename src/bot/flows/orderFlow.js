/**
 * orderFlow.js — Fixed with proper pagination
 * WhatsApp list max = 10 rows. Categories with more than 9 items use pagination.
 */

const { sendMessage, sendInteractive, requestLocation } = require('../whatsapp');
const { saveOrder, updateOrderStatus }                  = require('../../db/firestore');
const mpesa                                             = require('../../payments/mpesa');
const { generateOrderId, formatKES, sanitise }          = require('../../utils/helpers');

async function handle(phoneId, session, input, biz) {

  const isCategorised = biz.menuMode === 'categorised' && Array.isArray(biz.categories);

  switch (session.step) {

    case 'BROWSING': {
      console.log('[OrderFlow] BROWSING | isCategorised:', isCategorised, '| categories:', biz.categories && biz.categories.length, '| products:', biz.products && biz.products.length);

      if (input.startsWith('CAT_')) return handle(phoneId, { ...session, step: 'CATEGORY_ITEMS' }, input, biz);
      if (input.startsWith('ADD_')) return handle(phoneId, { ...session, step: 'ADD_TO_CART' }, input, biz);

      if (isCategorised) {
        var catRows = biz.categories.map(function(c) {
          var count = biz.products.filter(function(p) { return p.category === c.id; }).length;
          return { id: 'CAT_' + c.id, title: c.name.slice(0, 24), description: count + ' items available' };
        });

        await sendInteractive(phoneId, session.from, {
          type: 'list',
          body: { text: '\uD83C\uDF7D\uFE0F *' + (biz.name || 'Our Menu') + '*\n\nChoose a category:' },
          footer: { text: 'Reply menu to go back' },
          action: { button: 'View Menu', sections: [{ title: 'Menu Categories', rows: catRows }] }
        });

      } else {
        var products = biz.products || getDefaultProducts(biz.sector);
        var prodRows = products.slice(0, 9).map(function(p) {
          return {
            id: 'ADD_' + p.id,
            title: p.name.slice(0, 24),
            description: (formatKES(p.price) + ' - ' + (p.description || '')).slice(0, 72)
          };
        });

        await sendInteractive(phoneId, session.from, {
          type: 'list',
          body: { text: '\uD83D\uDED2 *' + (biz.name || 'Products') + '*\n\nSelect a product:' },
          footer: { text: 'Reply menu to go back' },
          action: { button: 'View Products', sections: [{ title: 'Products', rows: prodRows }] }
        });
      }

      return { ...session, step: 'BROWSING' };
    }

    case 'CATEGORY_ITEMS': {
      if (input.startsWith('ADD_')) return handle(phoneId, { ...session, step: 'ADD_TO_CART' }, input, biz);
      if (input === 'BACK_TO_CATS') return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz);

      if (input.startsWith('MORE_')) {
        var moreParts = input.split('_');
        var morePage  = parseInt(moreParts[moreParts.length - 1], 10) || 0;
        var moreCatId = moreParts.slice(1, -1).join('_');
        var moreItems = biz.products.filter(function(p) { return p.category === moreCatId; });
        var moreStart = 9 + (morePage * 9);
        var moreEnd   = moreStart + 9;
        var moreRows  = moreItems.slice(moreStart, moreEnd).map(function(p) {
          return {
            id: 'ADD_' + p.id,
            title: p.name.slice(0, 24),
            description: (formatKES(p.price) + ' - ' + (p.description || '')).slice(0, 72)
          };
        });

        if (moreItems.length > moreEnd) {
          moreRows.push({
            id: 'MORE_' + moreCatId + '_' + (morePage + 1),
            title: 'See More Items',
            description: (moreItems.length - moreEnd) + ' more items'
          });
        }

        await sendInteractive(phoneId, session.from, {
          type: 'list',
          body: { text: 'More items:' },
          footer: { text: 'Reply menu to restart' },
          action: { button: 'Choose Item', sections: [{ title: 'More Items', rows: moreRows }] }
        });
        return { ...session, step: 'CATEGORY_ITEMS', _currentCat: moreCatId };
      }

      if (input.startsWith('CAT_')) {
        var catId    = input.replace('CAT_', '');
        var category = biz.categories.find(function(c) { return c.id === catId; });
        var items    = biz.products.filter(function(p) { return p.category === catId; });

        if (!items.length) {
          await sendMessage(phoneId, session.from, 'No items in this category. Please choose another.');
          return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz);
        }

        var rows = items.slice(0, 9).map(function(p) {
          return {
            id: 'ADD_' + p.id,
            title: p.name.slice(0, 24),
            description: (formatKES(p.price) + ' - ' + (p.description || '')).slice(0, 72)
          };
        });

        if (items.length > 9) {
          rows.push({
            id: 'MORE_' + catId + '_0',
            title: 'See More Items',
            description: (items.length - 9) + ' more items available'
          });
        }

        await sendInteractive(phoneId, session.from, {
          type: 'list',
          body: { text: (category ? category.name : catId) + '\n\nSelect an item:' },
          footer: { text: 'Reply menu to restart' },
          action: { button: 'Choose Item', sections: [{ title: category ? category.name : 'Items', rows: rows }] }
        });

        return { ...session, step: 'CATEGORY_ITEMS', _currentCat: catId };
      }

      return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz);
    }

    case 'ADD_TO_CART': {
      if (!input.startsWith('ADD_')) return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz);

      var productId = input.replace('ADD_', '');
      var allProds  = biz.products || getDefaultProducts(biz.sector);
      var product   = allProds.find(function(p) { return p.id === productId; });

      if (!product) {
        await sendMessage(phoneId, session.from, 'Item not found. Please try again.');
        return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz);
      }

      await sendInteractive(phoneId, session.from, {
        type: 'button',
        body: { text: '*' + product.name + '*\n' + formatKES(product.price) + '\n' + (product.description || '') + '\n\nHow many?' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'QTY_' + productId + '_1', title: '1' } },
            { type: 'reply', reply: { id: 'QTY_' + productId + '_2', title: '2' } },
            { type: 'reply', reply: { id: 'QTY_' + productId + '_3', title: '3' } },
          ]
        }
      });

      return { ...session, step: 'CART_REVIEW' };
    }

    case 'CART_REVIEW': {
      // Route button presses immediately — never re-render cart for these
      if (input === 'CHECKOUT') {
        console.log('[OrderFlow] CHECKOUT -> asking for address directly');
        await sendMessage(phoneId, session.from,
          'Where should we deliver your order?\n\n' +
          'Please type your delivery address:\n' +
          '(e.g. Kerugoya stage, Land offices, ABC building)'
        );
        return { ...session, step: 'TYPING_ADDRESS' };
      }
      if (input === 'ADD_MORE')   { console.log('[OrderFlow] ADD_MORE tapped -> BROWSING'); return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz); }
      if (input === 'CLEAR_CART') { console.log('[OrderFlow] CLEAR_CART tapped -> BROWSING'); return handle(phoneId, { ...session, cart: [], step: 'BROWSING' }, '', biz); }

      if (input.startsWith('QTY_')) {
        var qtyParts = input.split('_');
        var qty      = parseInt(qtyParts[qtyParts.length - 1], 10);
        var pid      = qtyParts.slice(1, -1).join('_');
        var qtyProds = biz.products || getDefaultProducts(biz.sector);
        var qtyProd  = qtyProds.find(function(p) { return p.id === pid; });

        if (qtyProd && qty > 0) {
          var cart     = (session.cart || []).slice();
          var existing = -1;
          for (var i = 0; i < cart.length; i++) { if (cart[i].productId === pid) { existing = i; break; } }
          if (existing >= 0) {
            cart[existing] = { productId: cart[existing].productId, name: cart[existing].name, qty: cart[existing].qty + qty, unitPrice: cart[existing].unitPrice };
          } else {
            cart.push({ productId: pid, name: qtyProd.name, qty: qty, unitPrice: qtyProd.price });
          }
          session = { ...session, cart: cart };
        }
      }

      if (!session.cart || session.cart.length === 0) {
        await sendMessage(phoneId, session.from, 'Your cart is empty. Let\'s add something!');
        return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz);
      }

      var cartTotal = session.cart.reduce(function(s, i) { return s + i.qty * i.unitPrice; }, 0);
      var cartText  = session.cart.map(function(i) { return '- ' + i.name + ' x ' + i.qty + ' = ' + formatKES(i.qty * i.unitPrice); }).join('\n');

      await sendInteractive(phoneId, session.from, {
        type: 'button',
        body: { text: '*Your Order*\n\n' + cartText + '\n\n*Total: ' + formatKES(cartTotal) + '*' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'CHECKOUT',   title: 'Go to Payment' } },
            { type: 'reply', reply: { id: 'ADD_MORE',   title: 'Add More'   } },
            { type: 'reply', reply: { id: 'CLEAR_CART', title: 'Clear Cart' } },
          ]
        }
      });

      return { ...session, step: 'CART_REVIEW' };
    }

    case 'DELIVERY_DETAILS': {
      // Fallback — redirect to TYPING_ADDRESS immediately
      await sendMessage(phoneId, session.from,
        'Please type your delivery address:\n' +
        '(e.g. Kerugoya stage, Land offices, ABC building)'
      );
      return { ...session, step: 'TYPING_ADDRESS' };
    }

    case 'TYPING_ADDRESS': {
      // If it's a button ID (not a real address), re-ask
      var isButtonId = (input === 'CHECKOUT' || input === 'ADD_MORE' || input === 'CLEAR_CART' ||
                        input === 'PAY_MPESA_MANUAL' || input === 'PAY_COD' ||
                        input.startsWith('CAT_') || input.startsWith('ADD_') || input.startsWith('QTY_'));

      if (isButtonId) {
        await sendMessage(phoneId, session.from,
          'Please type your delivery address:\n' +
          '(e.g. Kerugoya stage, Land offices, ABC building)'
        );
        return { ...session, step: 'TYPING_ADDRESS' };
      }

      var typedAddr = sanitise(input);

      if (typedAddr.length < 2) {
        await sendMessage(phoneId, session.from,
          'Please type your delivery location.\n(e.g. Kerugoya stage, ABC building)'
        );
        return { ...session, step: 'TYPING_ADDRESS' };
      }

      // Valid address — go straight to payment
      console.log('[OrderFlow] Address received:', typedAddr, '-> PAYMENT_CHOICE');
      return { ...session, pendingAddr: typedAddr, step: 'PAYMENT_CHOICE' };
    }

    case 'PAYMENT_CHOICE': {
      var payTotal  = session.cart.reduce(function(s, i) { return s + i.qty * i.unitPrice; }, 0);
      var tillNum   = biz.mpesaTill || process.env.MPESA_TILL;
      var hasSTK    = (biz.mpesaShortcode || process.env.MPESA_SHORTCODE) && process.env.MPESA_KEY;

      // Two payment options only: Manual M-Pesa + Pay on Delivery
      if (input !== 'PAY_MPESA_MANUAL' && input !== 'PAY_COD') {
        await sendInteractive(phoneId, session.from, {
          type: 'button',
          body: { text: '*How would you like to pay?*\n\nOrder Total: *' + formatKES(payTotal) + '*\nDeliver to: ' + (session.pendingAddr || 'N/A') },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'PAY_MPESA_MANUAL', title: 'Pay via M-Pesa'   } },
              { type: 'reply', reply: { id: 'PAY_COD',          title: 'Pay on Delivery'  } },
            ]
          }
        });
        return { ...session, step: 'PAYMENT_CHOICE' };
      }

      var orderId = generateOrderId();

      if (input === 'PAY_MPESA_MANUAL') {
        await sendMessage(phoneId, session.from,
          'Order *' + orderId + '* placed! ✅\n\n' +
          'Please pay *' + formatKES(payTotal) + '* via M-Pesa:\n' +
          'Till Number: *' + (tillNum || '5214133') + '*\n' +
          'Account Ref: *' + orderId + '*\n\n' +
          'After paying, send your M-Pesa confirmation code here.\n' +
          '(e.g. QGH3K7XZZZ)\n\nReply *menu* to cancel.'
        );
        await saveOrder({ orderId: orderId, session: session, total: payTotal, status: 'PENDING_PAYMENT', biz: biz });
        return { ...session, step: 'AWAITING_PAYMENT', orderId: orderId };
      }

      if (input === 'PAY_COD') {
        await sendMessage(phoneId, session.from,
          'Order ' + orderId + ' confirmed!\n\n' +
          'Delivering to: ' + session.pendingAddr + '\n' +
          'Pay ' + formatKES(payTotal) + ' on delivery.\n\n' +
          'We will be with you shortly!'
        );
        await saveOrder({ orderId: orderId, session: session, total: payTotal, status: 'CONFIRMED_COD', biz: biz });
        return { ...session, step: 'MAIN_MENU', cart: [], orderId: null };
      }

      return { ...session, step: 'PAYMENT_CHOICE' };
    }

    case 'AWAITING_PAYMENT': {
      var code = input.toUpperCase().replace(/\s/g, '');
      if (/^[A-Z0-9]{10}$/.test(code)) {
        await sendMessage(phoneId, session.from,
          'Payment confirmed!\n\n' +
          'M-Pesa Code: *' + code + '*\n' +
          'Order *' + session.orderId + '* is being prepared.\n\n' +
          'We will notify you when it is on the way!'
        );
        await updateOrderStatus(session.orderId, 'PAID', { mpesaCode: code });
        return { ...session, step: 'MAIN_MENU', cart: [] };
      }

      if (input.length > 0) {
        await sendMessage(phoneId, session.from,
          'Waiting for payment.\n\nSend your M-Pesa code (10 characters e.g. QGH3K7XZZZ).\nReply menu to cancel.'
        );
      }
      return session;
    }

    default:
      return { ...session, step: 'MAIN_MENU' };
  }
}

function getDefaultProducts(sector) {
  var catalogues = {
    water: [
      { id: 'w5',  name: '5L Bottle',       price: 50,   description: 'Purified spring water' },
      { id: 'w10', name: '10L Jerry Can',    price: 80,   description: 'Refillable container'  },
      { id: 'w20', name: '20L Dispenser',    price: 150,  description: 'Home and office use'   },
      { id: 'wmo', name: 'Monthly Plan 20L', price: 2500, description: '20 deliveries per month'},
    ],
    gas: [
      { id: 'g6',  name: '6kg LPG',         price: 1500, description: 'Home cooking gas'      },
      { id: 'g13', name: '13kg LPG',         price: 2800, description: 'Large household'       },
      { id: 'g35', name: '35kg Commercial',  price: 6500, description: 'Restaurant or hotel'   },
    ],
    milk: [
      { id: 'm1',  name: '500ml Fresh Milk', price: 50,   description: 'Pasteurized whole milk'},
      { id: 'm2',  name: '1L Fresh Milk',    price: 90,   description: 'Daily household litre' },
    ],
    retail: [
      { id: 'r1',  name: 'Product A',        price: 100,  description: 'Add via admin panel'  },
      { id: 'r2',  name: 'Product B',        price: 250,  description: 'Add via admin panel'  },
    ],
  };
  return catalogues[sector] || catalogues.water;
}

module.exports = { handle: handle };
