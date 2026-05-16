/**
 * SupplyFlow V6 Universal — Main Server
 * Multi-tenant WhatsApp commerce platform
 * Works for: water, gas, milk, food delivery, retail, distributors
 */

require('dotenv').config();
const express = require('express');
const path    = require('path');
const crypto  = require('crypto');

const { handleIncomingMessage } = require('./src/bot/dispatcher');
const { verifySignature }        = require('./src/utils/security');
const adminRoutes                = require('./src/routes/admin');
const authRoutes                 = require('./src/routes/auth');

const app = express();

/* ── Middleware ──────────────────────────────────────────────── */
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* ── Auth / API routes ───────────────────────────────────────── */
app.use('/api/auth',  authRoutes);
app.use('/api/admin', adminRoutes);

/* ── WhatsApp Webhook verification (GET) ─────────────────────── */
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('[Webhook] Verified ✓');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/* ── WhatsApp Webhook events (POST) ──────────────────────────── */
console.log(`[DEBUG] webhook body:`, JSON.stringify(req.body).slice(0, 500));
//app.post('/webhook', async (req, res) => {
  // Acknowledge immediately (Meta requires <5s)
  res.sendStatus(200);

  // Optional: verify Meta signature
  if (process.env.APP_SECRET) {
    const sig = req.headers['x-hub-signature-256'];
    if (!verifySignature(req.rawBody, sig, process.env.APP_SECRET)) {
      console.warn('[Webhook] Invalid signature — skipping');
      return;
    }
  }

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const val = change.value;
        if (!val.messages) continue;
        for (const msg of val.messages) {
          await handleIncomingMessage(msg, val.metadata, val.contacts?.[0]);
        }
      }
    }
  } catch (err) {
    console.error('[Webhook] Handler error:', err.message);
  }
});

/* ── Health check ────────────────────────────────────────────── */
app.get('/api/health', (_req, res) => res.json({
  ok: true, version: 'V6 Universal', ts: new Date().toISOString()
}));

/* ── SPA fallback ────────────────────────────────────────────── */
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/webhook')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[SupplyFlow V6] Running on port ${PORT}`));
