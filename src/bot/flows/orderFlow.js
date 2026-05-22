/**
 * orderFlow.js — Fixed & Universal
 * Handles flat menus (water, gas, milk) and categorised menus (hotels, restaurants)
 *
 * FIXED:
 *  - Duplicate CATEGORY_ITEMS case removed — was breaking all button responses
 *  - Pagination merged into single CATEGORY_ITEMS handler
 *  - BROWSING correctly delegates without double-render
 */

const { sendMessage, sendInteractive, requestLocation } = require('../whatsapp');
const { saveOrder, updateOrderStatus }                  = require('../../db/firestore');
const mpesa                                             = require('../../payments/mpesa');
const { generateOrderId, formatKES, sanitise }          = require('../../utils/helpers');

async function handle(phoneId, session, input, biz) {

  const isCategorised = biz.menuMode === 'categorised' && Array.isArray(biz.categories);

  switch (session.step) {

    /* ── 1. BROWSING — show categories or flat product list ── */
    case 'BROWSING': {
      // Delegate immediately if input already has a selection
      if (input.startsWith('CAT_')) return handle(phoneId, { ...session, step: 'CATEGORY_ITEMS' }, input, biz);
      if (input.startsWith('ADD_')) return handle(phoneId, { ...session, step: 'ADD_TO_CART' }, input, biz);

      if (isCategorised) {
        const rows = biz.categories.map(c => ({
          id:          `CAT_${c.id}`,
          title:       c.name.slice(0, 24),
          description: `${biz.products.filter(p => p.category === c.id).length} items available`
        }));

        await sendInteractive(phoneId, session.from, {
          type: 'list',
          body: { text: `🍽️ *${biz.name}*\n\nChoose a category:` },
          footer: { text: 'Reply *menu* to go back' },
          action: { button: 'View Menu', sections: [{ title: 'Menu Categories', rows }] }
        });

      } else {
        // Flat product list
        const products = biz.products || getDefaultProducts(biz.sector);
        const rows = products.slice(0, 10).map(p => ({
          id:          `ADD_${p.id}`,
          title:       p.name.slice(0, 24),
          description: `${formatKES(p.price)} — ${p.description || ''}`.slice(0, 72)
        }));

        await sendInteractive(phoneId, session.from, {
          type: 'list',
          body: { text: `🛒 *${biz.name}*\n\nSelect a product:` },
          footer: { text: 'Reply *menu* to go back' },
          action: { button: 'View Products', sections: [{ title: 'Products', rows }] }
        });
      }

      return { ...session, step: 'BROWSING' };
    }

    /* ── 2. CATEGORY_ITEMS — show products in chosen category ── */
    case 'CATEGORY_ITEMS': {
      // Product selected — go to cart
      if (input.startsWith('ADD_')) {
        return handle(phoneId, { ...session, step: 'ADD_TO_CART' }, input, biz);
      }

      // Back to categories
      if (input === 'BACK_TO_CATS') {
        return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz);
      }

      // Page 2 of a category
      if (input.startsWith('MORE_')) {
        const catId = input.replace('MORE_', '');
        const items = biz.products.filter(p => p.category === catId);
        const rows  = items.slice(10, 20).map(p => ({
          id:          `ADD_${p.id}`,
          title:       p.name.slice(0, 24),
          description: `${formatKES(p.price)} — ${p.description || ''}`.slice(0, 72)
        }));

        await sendInteractive(phoneId, session.from, {
          type: 'list',
          body: { text: `More items:` },
          footer: { text: 'Reply *menu* to restart' },
          action: { button: 'Choose Item', sections: [{ title: 'More Items', rows }] }
        });
        return { ...session, step: 'CATEGORY_ITEMS', _currentCat: catId };
      }

      // Category selected — show its products
      if (input.startsWith('CAT_')) {
        const catId    = input.replace('CAT_', '');
        const category = biz.categories.find(c => c.id === catId);
        const items    = biz.products.filter(p => p.category === catId);

        if (!items.length) {
          await sendMessage(phoneId, session.from, '⚠️ No items in this category. Please choose another.');
          return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz);
        }

        const rows = items.slice(0, 10).map(p => ({
          id:          `ADD_${p.id}`,
          title:       p.name.slice(0, 24),
          description: `${formatKES(p.price)} — ${p.description || ''}`.slice(0, 72)
        }));

        if (items.length > 10) {
          rows.push({
            id:          `MORE_${catId}`,
            title:       '➡️ See More Items',
            description: `${items.length - 10} more items`
          });
        }

        await sendInteractive(phoneId, session.from, {
          type: 'list',
          body: { text: `${category?.name || catId}\n\nSelect an item:` },
          footer: { text: 'Reply *menu* to restart' },
          action: { button: 'Choose Item', sections: [{ title: category?.name || 'Items', rows }] }
        });

        return { ...session, step: 'CATEGORY_ITEMS', _currentCat: catId };
      }

      // Unknown input — go back to browsing
      return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz);
    }

    /* ── 3. ADD_TO_CART — choose quantity ───────────────────── */
    case 'ADD_TO_CART': {
      if (!input.startsWith('ADD_')) {
        return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz);
      }

      const productId = input.replace('ADD_', '');
      const allProds  = biz.products || getDefaultProducts(biz.sector);
      const product   = allProds.find(p => p.id === productId);

      if (!product) {
        await sendMessage(phoneId, session.from, '⚠️ Item not found. Please try again.');
        return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz);
      }

      await sendInteractive(phoneId, session.from, {
        type: 'button',
        body: { text: `*${product.name}*\n${formatKES(product.price)}\n${product.description || ''}\n\nHow many?` },
        action: {
          buttons: [
            { type: 'reply', reply: { id: `QTY_${productId}_1`, title: '1' } },
            { type: 'reply', reply: { id: `QTY_${productId}_2`, title: '2' } },
            { type: 'reply', reply: { id: `QTY_${productId}_3`, title: '3' } },
          ]
        }
      });

      return { ...session, step: 'CART_REVIEW' };
    }

    /* ── 4. CART_REVIEW ─────────────────────────────────────── */
    case 'CART_REVIEW': {
      if (input.startsWith('QTY_')) {
        const parts   = input.split('_');
        const qty     = parseInt(parts[parts.length - 1], 10);
        const pid     = parts.slice(1, -1).join('_');
        const allProds= biz.products || getDefaultProducts(biz.sector);
        const product = allProds.find(p => p.id === pid);

        if (product && qty > 0) {
          const cart     = [...(session.cart || [])];
          const existing = cart.findIndex(i => i.productId === pid);
          if (existing >= 0) {
            cart[existing] = { ...cart[existing], qty: cart[existing].qty + qty };
          } else {
            cart.push({ productId: pid, name: product.name, qty, unitPrice: product.price });
          }
          session = { ...session, cart };
        }
      }

      if (!session.cart || session.cart.length === 0) {
        await sendMessage(phoneId, session.from, 'Your cart is empty. Let\'s add something! 🛒');
        return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz);
      }

      const total    = session.cart.reduce((s, i) => s + i.qty * i.unitPrice, 0);
      const cartText = session.cart.map(i =>
        `• ${i.name} × ${i.qty} = ${formatKES(i.qty * i.unitPrice)}`
      ).join('\n');

      await sendInteractive(phoneId, session.from, {
        type: 'button',
        body: { text: `🛒 *Your Order*\n\n${cartText}\n\n*Total: ${formatKES(total)}*` },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'CHECKOUT',   title: '✅ Checkout'   } },
            { type: 'reply', reply: { id: 'ADD_MORE',   title: '➕ Add More'   } },
            { type: 'reply', reply: { id: 'CLEAR_CART', title: '🗑️ Clear Cart' } },
          ]
        }
      });

      if (input === 'CHECKOUT')   return { ...session, step: 'DELIVERY_DETAILS' };
      if (input === 'ADD_MORE')   return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz);
      if (input === 'CLEAR_CART') return handle(phoneId, { ...session, cart: [], step: 'BROWSING' }, '', biz);

      return { ...session, step: 'CART_REVIEW' };
    }

    /* ── 5. DELIVERY_DETAILS ────────────────────────────────── */
    case 'DELIVERY_DETAILS': {
      if (session.location && !session._locationConfirmed) {
        const loc  = session.location;
        const addr = loc.name || loc.address || `${loc.latitude}, ${loc.longitude}`;
        session    = { ...session, pendingAddr: addr, _locationConfirmed: true };

        await sendInteractive(phoneId, session.from, {
          type: 'button',
          body: { text: `📍 Deliver to:\n*${addr}*\n\nConfirm?` },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'ADDR_OK',     title: '✅ Yes, correct' } },
              { type: 'reply', reply: { id: 'ADDR_RETYPE', title: '✏️ Type address' } },
            ]
          }
        });
        return session;
      }

      if (input === 'ADDR_OK')     return { ...session, step: 'PAYMENT_CHOICE' };
      if (input === 'ADDR_RETYPE') {
        await sendMessage(phoneId, session.from,
          '📝 Type your delivery address:\n(Building, street or nearest landmark)');
        return { ...session, step: 'TYPING_ADDRESS', _locationConfirmed: false, location: null };
      }

      await requestLocation(phoneId, session.from,
        '📍 *Where should we deliver?*\n\nShare your location or type your address below.');
      return { ...session, step: 'DELIVERY_DETAILS' };
    }

    /* ── 5b. TYPING_ADDRESS ─────────────────────────────────── */
    case 'TYPING_ADDRESS': {
      if (input === 'ADDR_OK')     return { ...session, step: 'PAYMENT_CHOICE' };
      if (input === 'ADDR_RETYPE') {
        await sendMessage(phoneId, session.from, '📝 Type your delivery address:');
        return { ...session, step: 'TYPING_ADDRESS', _locationConfirmed: false };
      }

      const addr = sanitise(input);
      if (addr.length < 5) {
        await sendMessage(phoneId, session.from, '⚠️ Please type a complete address (at least 5 characters).');
        return session;
      }

      await sendInteractive(phoneId, session.from, {
        type: 'button',
        body: { text: `📍 Deliver to:\n*${addr}*\n\nConfirm?` },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'ADDR_OK',     title: '✅ Yes, correct' } },
            { type: 'reply', reply: { id: 'ADDR_RETYPE', title: '✏️ Change it'    } },
          ]
        }
      });

      return { ...session, pendingAddr: addr, step: 'DELIVERY_DETAILS', _locationConfirmed: true };
    }

    /* ── 6. PAYMENT_CHOICE ──────────────────────────────────── */
    case 'PAYMENT_CHOICE': {
      const total   = session.cart.reduce((s, i) => s + i.qty * i.unitPrice, 0);
      const tillNum = biz.mpesaTill || process.env.MPESA_TILL;
      const hasSTK  = (biz.mpesaShortcode || process.env.MPESA_SHORTCODE) && process.env.MPESA_KEY;

      const buttons = [];
      if (hasSTK) buttons.push({ type: 'reply', reply: { id: 'PAY_MPESA_STK',    title: '⚡ M-Pesa Push'    } });
      buttons.push(  { type: 'reply', reply: { id: 'PAY_MPESA_MANUAL', title: '📲 M-Pesa Manual'  } });
      buttons.push(  { type: 'reply', reply: { id: 'PAY_COD',          title: '💵 Pay on Delivery' } });

      if (!['PAY_MPESA_STK','PAY_MPESA_MANUAL','PAY_COD'].includes(input)) {
        await sendInteractive(phoneId, session.from, {
          type: 'button',
          body: { text: `💳 *Payment — ${formatKES(total)}*\n\n📍 ${session.pendingAddr || 'N/A'}\n\nChoose payment method:` },
          action: { buttons: buttons.slice(0, 3) }
        });
        return { ...session, step: 'PAYMENT_CHOICE' };
      }

      const orderId = generateOrderId();

      if (input === 'PAY_MPESA_MANUAL') {
        await sendMessage(phoneId, session.from,
          `✅ *Order ${orderId} placed!*\n\n` +
          `💳 Pay *${formatKES(total)}* via M-Pesa:\n` +
          `📲 Till: *${tillNum}*\n` +
          `Ref: *${orderId}*\n\n` +
          `Send your M-Pesa code here after paying (e.g. *QGH3K7XZZZ*).\n\nReply *menu* to cancel.`
        );
        await saveOrder({ orderId, session, total, status: 'PENDING_PAYMENT', biz });
        return { ...session, step: 'AWAITING_PAYMENT', orderId };
      }

      if (input === 'PAY_MPESA_STK') {
        await sendMessage(phoneId, session.from, `⚡ Sending M-Pesa prompt to your phone…`);
        try {
          await mpesa.stkPush({ phone: session.from, amount: total, orderId, biz });
          await saveOrder({ orderId, session, total, status: 'PENDING_PAYMENT', biz });
          await sendMessage(phoneId, session.from,
            `📲 Enter your M-Pesa PIN on your phone.\nOrder ID: *${orderId}*`);
        } catch (e) {
          await sendMessage(phoneId, session.from,
            `⚠️ Push failed. Pay manually:\n📲 Till: *${tillNum}*\nRef: *${orderId}*`);
          await saveOrder({ orderId, session, total, status: 'PENDING_PAYMENT', biz });
        }
        return { ...session, step: 'AWAITING_PAYMENT', orderId };
      }

      if (input === 'PAY_COD') {
        await sendMessage(phoneId, session.from,
          `✅ *Order ${orderId} confirmed!* 🎉\n\n` +
          `🚚 Delivering to: ${session.pendingAddr}\n` +
          `💵 Pay *${formatKES(total)}* on delivery.\n\n` +
          `We'll be with you shortly!\n` +
          `Track: reply *menu* → *Track Order* → *${orderId}*`
        );
        await saveOrder({ orderId, session, total, status: 'CONFIRMED_COD', biz });
        return { ...session, step: 'MAIN_MENU', cart: [], orderId: null };
      }

      return { ...session, step: 'PAYMENT_CHOICE' };
    }

    /* ── 7. AWAITING_PAYMENT ────────────────────────────────── */
    case 'AWAITING_PAYMENT': {
      const code = input.toUpperCase().replace(/\s/g, '');
      if (/^[A-Z0-9]{10}$/.test(code)) {
        await sendMessage(phoneId, session.from,
          `✅ *Payment confirmed!*\n\n` +
          `M-Pesa Code: *${code}*\n` +
          `Order *${session.orderId}* is being prepared. 🍽️\n\n` +
          `We'll notify you when it's on the way!`
        );
        await updateOrderStatus(session.orderId, 'PAID', { mpesaCode: code });
        return { ...session, step: 'MAIN_MENU', cart: [] };
      }

      if (input.length > 0) {
        await sendMessage(phoneId, session.from,
          `⏳ Waiting for payment.\n\nSend your M-Pesa code (10 characters e.g. *QGH3K7XZZZ*).\nReply *menu* to cancel.`
        );
      }
      return session;
    }

    default:
      return { ...session, step: 'MAIN_MENU' };
  }
}

/* ── Default flat catalogues ────────────────────────────────── */
function getDefaultProducts(sector) {
  const catalogues = {
    water: [
      { id: 'w5',  name: '5L Bottle',       price: 50,   description: 'Purified spring water' },
      { id: 'w10', name: '10L Jerry Can',    price: 80,   description: 'Refillable container'  },
      { id: 'w20', name: '20L Dispenser',    price: 150,  description: 'Home and office use'   },
      { id: 'wmo', name: 'Monthly Plan 20L', price: 2500, description: '20 deliveries/month'   },
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

module.exports = { handle };
