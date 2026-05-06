/**
 * Order Flow
 * Handles the full purchase journey:
 *   BROWSING → ADD_TO_CART → CART_REVIEW → DELIVERY_DETAILS
 *   → TYPING_ADDRESS → PAYMENT_CHOICE → AWAITING_PAYMENT → ORDER_CONFIRM
 *
 * PATCHED:
 *  - BUG 3: BROWSING no longer double-renders when ADD_ input arrives
 *  - Input sanitisation on delivery address (XSS prevention)
 *  - getProducts removed (was an undefined import from firestore)
 */

const { sendMessage, sendInteractive, requestLocation } = require('../whatsapp');
const { saveOrder, updateOrderStatus }                  = require('../../db/firestore');
const mpesa                                             = require('../../payments/mpesa');
const { generateOrderId, formatKES, sanitise }          = require('../../utils/helpers');

async function handle(phoneId, session, input, biz) {
  switch (session.step) {

    /* ── 1. Product catalogue ──────────────────────────────── */
    case 'BROWSING': {
      // FIX: If ADD_ arrives while in BROWSING, jump straight to ADD_TO_CART.
      // Previously the catalogue was rendered AND the input was ignored,
      // forcing the customer to tap again.
      if (input.startsWith('ADD_')) {
        return handle(phoneId, { ...session, step: 'ADD_TO_CART' }, input, biz);
      }

      const products = biz.products || getDefaultProducts(biz.sector);
      const rows = products.map(p => ({
        id:          `ADD_${p.id}`,
        title:       p.name.slice(0, 24),
        description: `${formatKES(p.price)} — ${p.description || ''}`.slice(0, 72)
      }));

      await sendInteractive(phoneId, session.from, {
        type: 'list',
        body: { text: `🛒 *${biz.name || 'Our Products'}*\n\nSelect a product to add to your cart:` },
        footer: { text: 'Reply *menu* to go back' },
        action: {
          button: 'View Products',
          sections: [{ title: 'Available Products', rows }]
        }
      });

      return { ...session, step: 'BROWSING' };
    }

    /* ── 2. Add item to cart ───────────────────────────────── */
    case 'ADD_TO_CART': {
      if (!input.startsWith('ADD_')) {
        return handle(phoneId, { ...session, step: 'BROWSING' }, input, biz);
      }

      const productId = input.replace('ADD_', '');
      const products  = biz.products || getDefaultProducts(biz.sector);
      const product   = products.find(p => p.id === productId);

      if (!product) {
        await sendMessage(phoneId, session.from, '⚠️ Product not found. Please try again.');
        return handle(phoneId, { ...session, step: 'BROWSING' }, '', biz);
      }

      await sendInteractive(phoneId, session.from, {
        type: 'button',
        body: { text: `*${product.name}* — ${formatKES(product.price)}\n\nHow many would you like?` },
        action: {
          buttons: [
            { type: 'reply', reply: { id: `QTY_${productId}_1`, title: '1' } },
            { type: 'reply', reply: { id: `QTY_${productId}_2`, title: '2' } },
            { type: 'reply', reply: { id: `QTY_${productId}_5`, title: '5' } },
          ]
        }
      });

      return { ...session, step: 'CART_REVIEW', _pendingProduct: product };
    }

    /* ── 3. Cart review ────────────────────────────────────── */
    case 'CART_REVIEW': {
      // Handle quantity selection
      if (input.startsWith('QTY_')) {
        const parts    = input.split('_'); // QTY_productId_qty
        const qty      = parseInt(parts[parts.length - 1], 10);
        const pid      = parts.slice(1, -1).join('_');
        const products = biz.products || getDefaultProducts(biz.sector);
        const product  = products.find(p => p.id === pid);

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
        body: { text: `🛒 *Your Cart*\n\n${cartText}\n\n*Total: ${formatKES(total)}*` },
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

    /* ── 4. Delivery details ───────────────────────────────── */
    case 'DELIVERY_DETAILS': {
      // Customer just shared their GPS location
      if (session.location && !session._locationConfirmed) {
        const loc  = session.location;
        const addr = loc.name || loc.address || `${loc.latitude}, ${loc.longitude}`;
        session    = { ...session, pendingAddr: addr, _locationConfirmed: true };

        await sendInteractive(phoneId, session.from, {
          type: 'button',
          body: { text: `📍 Deliver to:\n*${addr}*\n\nIs this correct?` },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'ADDR_OK',    title: '✅ Yes, correct'  } },
              { type: 'reply', reply: { id: 'ADDR_RETYPE', title: '✏️ Type address' } },
            ]
          }
        });
        return session;
      }

      if (input === 'ADDR_OK')    return { ...session, step: 'PAYMENT_CHOICE' };
      if (input === 'ADDR_RETYPE') {
        await sendMessage(phoneId, session.from,
          '📝 Type your full delivery address:\n(Street, area, and a landmark if possible)');
        return { ...session, step: 'TYPING_ADDRESS', _locationConfirmed: false, location: null };
      }

      // First visit — request location pin or allow typed address
      await requestLocation(phoneId, session.from,
        '📍 *Where should we deliver?*\n\nTap the button to share your location, or just type your address below.');
      return { ...session, step: 'DELIVERY_DETAILS' };
    }

    /* ── 4b. Typed address ─────────────────────────────────── */
    case 'TYPING_ADDRESS': {
      // Sanitise input — strip HTML/script tags
      const addr = sanitise(input);

      if (addr.length < 5) {
        await sendMessage(phoneId, session.from,
          '⚠️ Please type a more complete address (at least 5 characters).');
        return session;
      }

      await sendInteractive(phoneId, session.from, {
        type: 'button',
        body: { text: `📍 Deliver to:\n*${addr}*\n\nConfirm?` },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'ADDR_OK',    title: '✅ Yes, correct'  } },
            { type: 'reply', reply: { id: 'ADDR_RETYPE', title: '✏️ Change it'    } },
          ]
        }
      });

      return { ...session, pendingAddr: addr, step: 'DELIVERY_DETAILS', _locationConfirmed: true };
    }

    /* ── 5. Payment choice ─────────────────────────────────── */
    case 'PAYMENT_CHOICE': {
      const total    = session.cart.reduce((s, i) => s + i.qty * i.unitPrice, 0);
      const tillNum  = biz.mpesaTill    || process.env.MPESA_TILL;
      const hasSTK   = (biz.mpesaShortcode || process.env.MPESA_SHORTCODE) && process.env.MPESA_KEY;

      const buttons = [];
      if (hasSTK) {
        buttons.push({ type: 'reply', reply: { id: 'PAY_MPESA_STK',    title: '⚡ M-Pesa Push'    } });
      }
      buttons.push({ type: 'reply', reply: { id: 'PAY_MPESA_MANUAL', title: '📲 M-Pesa Manual'  } });
      buttons.push({ type: 'reply', reply: { id: 'PAY_COD',          title: '💵 Pay on Delivery' } });

      if (!['PAY_MPESA_STK','PAY_MPESA_MANUAL','PAY_COD'].includes(input)) {
        await sendInteractive(phoneId, session.from, {
          type: 'button',
          body: { text: `💳 *Payment — ${formatKES(total)}*\n\nDelivery to: ${session.pendingAddr || 'N/A'}\n\nChoose payment method:` },
          action: { buttons: buttons.slice(0, 3) }
        });
        return { ...session, step: 'PAYMENT_CHOICE' };
      }

      const orderId = generateOrderId();

      if (input === 'PAY_MPESA_MANUAL') {
        await sendMessage(phoneId, session.from,
          `✅ *Order ${orderId} created!*\n\n` +
          `💳 Pay *${formatKES(total)}* via M-Pesa:\n` +
          `📲 Till Number: *${tillNum}*\n` +
          `Reference: *${orderId}*\n\n` +
          `After paying, send your M-Pesa confirmation code here (e.g. *QGH3K7XZZZ*).\n\n` +
          `Reply *menu* to cancel.`
        );
        await saveOrder({ orderId, session, total, status: 'PENDING_PAYMENT', biz });
        return { ...session, step: 'AWAITING_PAYMENT', orderId };
      }

      if (input === 'PAY_MPESA_STK') {
        await sendMessage(phoneId, session.from,
          `⚡ Sending M-Pesa prompt to your phone…\nCheck your phone and enter your PIN.`);
        try {
          await mpesa.stkPush({ phone: session.from, amount: total, orderId, biz });
          await saveOrder({ orderId, session, total, status: 'PENDING_PAYMENT', biz });
          await sendMessage(phoneId, session.from,
            `📲 STK push sent for *${formatKES(total)}*.\n\nEnter your M-Pesa PIN on your phone.\n` +
            `Your order ID is *${orderId}*.\n\nReply *menu* to cancel.`);
          return { ...session, step: 'AWAITING_PAYMENT', orderId };
        } catch (e) {
          console.error('[STK Push]', e.message);
          await sendMessage(phoneId, session.from,
            `⚠️ STK push failed. Please pay manually:\n📲 Till: *${tillNum}*\nRef: *${orderId}*\n\nSend your M-Pesa code after paying.`);
          await saveOrder({ orderId, session, total, status: 'PENDING_PAYMENT', biz });
          return { ...session, step: 'AWAITING_PAYMENT', orderId };
        }
      }

      if (input === 'PAY_COD') {
        await sendMessage(phoneId, session.from,
          `✅ *Order ${orderId} confirmed!* 🎉\n\n` +
          `🚚 Delivering to: ${session.pendingAddr}\n` +
          `💵 Pay *${formatKES(total)}* on delivery.\n\n` +
          `We'll contact you shortly with driver details.\n` +
          `Track your order: reply *menu* → *Track Order* → *${orderId}*`
        );
        await saveOrder({ orderId, session, total, status: 'CONFIRMED_COD', biz });
        return { ...session, step: 'MAIN_MENU', cart: [], orderId: null };
      }

      return { ...session, step: 'PAYMENT_CHOICE' };
    }

    /* ── 6. Awaiting M-Pesa code ───────────────────────────── */
    case 'AWAITING_PAYMENT': {
      const mpesaCode = input.toUpperCase().replace(/\s/g, '');
      const isMpesaCode = /^[A-Z0-9]{10}$/.test(mpesaCode);

      if (isMpesaCode) {
        await sendMessage(phoneId, session.from,
          `✅ *Payment received — thank you!*\n\n` +
          `M-Pesa Code: *${mpesaCode}*\n` +
          `Order *${session.orderId}* is being processed.\n\n` +
          `We'll notify you when your order ships. 🚚\n\n` +
          `Reply *menu* to go back to the main menu.`
        );
        await updateOrderStatus(session.orderId, 'PAID', { mpesaCode });
        return { ...session, step: 'MAIN_MENU', cart: [] };
      }

      // Nudge if they send something unrecognised
      if (input.length > 0) {
        await sendMessage(phoneId, session.from,
          `⏳ Still waiting for payment.\n\n` +
          `Please send your *M-Pesa code* — it looks like: *QGH3K7XZZZ* (10 characters).\n\n` +
          `Reply *menu* to cancel the order.`
        );
      }
      return session;
    }

    default:
      return { ...session, step: 'MAIN_MENU' };
  }
}

/* ── Default product catalogues by sector ───────────────────── */
function getDefaultProducts(sector) {
  const catalogues = {
    water: [
      { id: 'w5',  name: '5L Bottle',          price: 50,   description: 'Purified spring water' },
      { id: 'w10', name: '10L Jerry Can',       price: 80,   description: 'Refillable container'  },
      { id: 'w20', name: '20L Dispenser',       price: 150,  description: 'Home/office use'       },
      { id: 'wmo', name: 'Monthly Plan 20L',    price: 2500, description: '20 deliveries/month'   },
    ],
    gas: [
      { id: 'g6',  name: '6kg LPG Cylinder',   price: 1500, description: 'Home cooking gas'      },
      { id: 'g13', name: '13kg LPG Cylinder',   price: 2800, description: 'Large household'       },
      { id: 'g35', name: '35kg Commercial',     price: 6500, description: 'Restaurant / hotel'    },
    ],
    food: [
      { id: 'f1',  name: 'Lunch Special',       price: 200,  description: 'Rice + stew + salad'  },
      { id: 'f2',  name: 'Family Meal',         price: 800,  description: 'Feeds 4–5 people'     },
      { id: 'f3',  name: 'Breakfast Box',       price: 150,  description: 'Eggs + tea + mandazi'  },
    ],
    milk: [
      { id: 'm1',  name: '500ml Fresh Milk',    price: 50,   description: 'Pasteurized whole milk'},
      { id: 'm2',  name: '1L Fresh Milk',       price: 90,   description: 'Daily household litre' },
      { id: 'm7',  name: 'Weekly 7L Plan',      price: 580,  description: 'Daily 1L for 7 days'  },
    ],
    retail: [
      { id: 'r1',  name: 'Product A',           price: 100,  description: 'Add via admin panel'  },
      { id: 'r2',  name: 'Product B',           price: 250,  description: 'Add via admin panel'  },
      { id: 'r3',  name: 'Product C',           price: 500,  description: 'Add via admin panel'  },
    ],
  };
  return catalogues[sector] || catalogues.water;
}

module.exports = { handle };
