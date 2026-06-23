/**
 * Admin REST API
 * All routes require Bearer token auth (set ADMIN_TOKEN in .env)
 *
 * PATCHED:
 *  - M-Pesa callback moved OUTSIDE requireAuth (Safaricom can't send auth header)
 *  - Callback now sends WhatsApp confirmation message to customer on payment
 *  - Input validation added to PATCH /orders/:id/status
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db/firestore');

/* ── Auth middleware ─────────────────────────────────────────── */
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (token && token === process.env.ADMIN_TOKEN) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC ROUTES (no auth) — must be registered BEFORE requireAuth
   ═══════════════════════════════════════════════════════════════ */

/**
 * M-Pesa STK Push callback — called by Safaricom servers after payment.
 * FIX: Moved outside requireAuth. Safaricom cannot send admin tokens.
 * Safaricom retries 3x if no 200 within 5 seconds — always respond first.
 */
router.post('/mpesa/callback', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' }); // respond immediately
  try {
    const stk = req.body?.Body?.stkCallback;
    if (!stk) return;

    const { ResultCode, CallbackMetadata } = stk;
    if (ResultCode !== 0) {
      console.log(`[M-Pesa] STK declined — ResultCode ${ResultCode}`);
      return;
    }

    const items     = CallbackMetadata?.Item || [];
    const get       = name => items.find(i => i.Name === name)?.Value;
    const mpesaCode = get('MpesaReceiptNumber');
    const amount    = get('Amount');
    const phone     = String(get('PhoneNumber') || '');
    const orderId   = get('AccountReference');

    if (orderId) {
      await db.updateOrderStatus(orderId, 'PAID', { mpesaCode, amount, phone });
      console.log(`[M-Pesa] ✅ ${orderId} PAID — ${mpesaCode} — KES ${amount}`);

      // Notify customer on WhatsApp
      try {
        const { sendMessage } = require('../bot/whatsapp');
        const phoneNumberId   = process.env.PHONE_NUMBER_ID;
        if (phone && phoneNumberId) {
          await sendMessage(phoneNumberId, phone,
            `✅ *Payment Confirmed!*\n\n` +
            `M-Pesa Code: *${mpesaCode}*\n` +
            `Order: *${orderId}*\n` +
            `Amount: KES ${amount}\n\n` +
            `Your order is now being processed. We'll notify you when it ships. 🚚\n\n` +
            `Reply *TRACK* → *${orderId}* to check status anytime.`
          );
        }
      } catch (notifyErr) {
        console.error('[M-Pesa] WhatsApp notify failed:', notifyErr.message);
      }
    }
  } catch (err) {
    console.error('[M-Pesa callback]', err.message);
  }
});

/* ═══════════════════════════════════════════════════════════════
   PROTECTED ROUTES — all routes below require admin auth
   ═══════════════════════════════════════════════════════════════ */
router.use(requireAuth);

/* ── Dashboard stats ─────────────────────────────────────────── */
router.get('/stats', async (req, res) => {
  try {
    const bizId  = req.query.bizId || process.env.BUSINESS_ID || 'default';
    const stats  = await db.getDailyStats(bizId, 30);
    const orders = await db.getOrdersByBiz(bizId, 500);
    const clients= await db.getClients(bizId, 500);

    const today     = new Date().toISOString().slice(0, 10);
    const todayStat = stats.find(s => s.date === today) || {};

    res.json({
      ordersToday:  todayStat.ordersCount || 0,
      revenueToday: todayStat.revenue     || 0,
      totalOrders:  orders.length,
      totalClients: clients.length,
      mrr:          stats.slice(0, 30).reduce((s, d) => s + (d.revenue || 0), 0),
      recentStats:  stats.slice(0, 14),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Orders ─────────────────────────────────────────────────── */
router.get('/orders', async (req, res) => {
  try {
    const bizId  = req.query.bizId || process.env.BUSINESS_ID || 'default';
    const orders = await db.getOrdersByBiz(bizId);
    res.json(orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/orders/:id', async (req, res) => {
  try {
    const order = await db.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const VALID_STATUSES = ['PENDING_PAYMENT','PAID','CONFIRMED_COD','PROCESSING','DISPATCHED','DELIVERED','CANCELLED'];

router.patch('/orders/:id/status', async (req, res) => {
  try {
    const { status, driverPhone, note } = req.body;

    // Input validation
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    await db.updateOrderStatus(req.params.id, status, {
      driverPhone: driverPhone || null,
      note:        note        || null,
    });

    // Notify customer when order is dispatched
    if (status === 'DISPATCHED') {
      try {
        const order = await db.getOrder(req.params.id);
        const { sendMessage } = require('../bot/whatsapp');
        const phoneNumberId   = process.env.PHONE_NUMBER_ID;
        if (order?.customerPhone && phoneNumberId) {
          const driverInfo = driverPhone ? `\n📞 Driver: wa.me/${driverPhone}` : '';
          await sendMessage(phoneNumberId, order.customerPhone,
            `🚚 *Your order is on the way!*\n\n` +
            `Order: *${req.params.id}*${driverInfo}\n\n` +
            `Reply *menu* to place another order.`
          );
        }
      } catch (notifyErr) {
        console.error('[Dispatch notify]', notifyErr.message);
      }
    }

    // Notify customer when order is delivered
    if (status === 'DELIVERED') {
      try {
        const order = await db.getOrder(req.params.id);
        const { sendMessage } = require('../bot/whatsapp');
        const phoneNumberId   = process.env.PHONE_NUMBER_ID;
        if (order?.customerPhone && phoneNumberId) {
          await sendMessage(phoneNumberId, order.customerPhone,
            `✅ *Order Delivered!*\n\n` +
            `Order: *${req.params.id}*\n\n` +
            `Thank you for ordering with us. Enjoy! 🎉\n\n` +
            `Reply *menu* to place another order.`
          );
        }
      } catch (notifyErr) {
        console.error('[Delivered notify]', notifyErr.message);
      }
    }

    // Notify customer when order is cancelled
    if (status === 'CANCELLED') {
      try {
        const order = await db.getOrder(req.params.id);
        const { sendMessage } = require('../bot/whatsapp');
        const phoneNumberId   = process.env.PHONE_NUMBER_ID;
        if (order?.customerPhone && phoneNumberId) {
          const noteInfo = note ? `\nReason: ${note}` : '';
          await sendMessage(phoneNumberId, order.customerPhone,
            `❌ *Order Cancelled*\n\n` +
            `Order: *${req.params.id}*${noteInfo}\n\n` +
            `If you have any questions, please contact us.\n\n` +
            `Reply *menu* to place a new order.`
          );
        }
      } catch (notifyErr) {
        console.error('[Cancelled notify]', notifyErr.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /orders/:id/notify-unavailable
 * Sends a custom WhatsApp message to the customer about an unavailable
 * item, suggesting alternatives. The customer's reply lands in the normal
 * WhatsApp chat for the business owner to handle manually -- the bot
 * does NOT auto-process this reply (by design, kept simple and human).
 */
router.post('/orders/:id/notify-unavailable', requireAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    const order = await db.getOrder(req.params.id);
    if (!order || !order.customerPhone) {
      return res.status(404).json({ error: 'Order or customer phone not found' });
    }

    const { sendMessage } = require('../bot/whatsapp');
    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    if (!phoneNumberId) {
      return res.status(500).json({ error: 'PHONE_NUMBER_ID not configured' });
    }

    await sendMessage(phoneNumberId, order.customerPhone,
      '⚠️ *Update on your order ' + req.params.id + '*\n\n' + message.trim()
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[Notify unavailable]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── Clients ─────────────────────────────────────────────────── */
router.get('/clients', async (req, res) => {
  try {
    const bizId   = req.query.bizId || process.env.BUSINESS_ID || 'default';
    const clients = await db.getClients(bizId);
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Business config ─────────────────────────────────────────── */
router.get('/config', async (req, res) => {
  try {
    const bizId = req.query.bizId || process.env.BUSINESS_ID || 'default';
    const biz   = await db.getBusinessConfig(bizId);
    res.json(biz);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const ALLOWED_CONFIG_KEYS = ['name','sector','greeting','supportPhone','mpesaTill','mpesaShortcode','products','currency'];

router.post('/config', async (req, res) => {
  try {
    const bizId = req.query.bizId || process.env.BUSINESS_ID || 'default';

    // Only allow safe keys — no injecting internal fields
    const safe = {};
    for (const key of ALLOWED_CONFIG_KEYS) {
      if (req.body[key] !== undefined) safe[key] = req.body[key];
    }

    await db.saveBusinessConfig(bizId, safe);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Manual payment confirm (admin marks order paid) ─────────── */
router.post('/orders/:id/confirm-payment', async (req, res) => {
  try {
    const { mpesaCode, amount, note } = req.body;
    await db.updateOrderStatus(req.params.id, 'PAID', { mpesaCode, amount, note, confirmedByAdmin: true });

    // Notify customer
    try {
      const order = await db.getOrder(req.params.id);
      const { sendMessage } = require('../bot/whatsapp');
      const phoneNumberId   = process.env.PHONE_NUMBER_ID;
      if (order?.customerPhone && phoneNumberId) {
        await sendMessage(phoneNumberId, order.customerPhone,
          `✅ *Payment confirmed by our team!*\n\nOrder *${req.params.id}* is now being processed. 🚚`
        );
      }
    } catch (_) {}

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
