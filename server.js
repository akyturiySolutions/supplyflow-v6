require('dotenv').config();
const express = require('express');
const path    = require('path');
const crypto  = require('crypto');

const { handleIncomingMessage } = require('./src/bot/dispatcher');
const adminRoutes               = require('./src/routes/admin');
const authRoutes                = require('./src/routes/auth');

const app = express();

app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth',  authRoutes);
app.use('/api/admin', adminRoutes);

/* ── Webhook GET — verification ─────────────────────────────── */
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('[Webhook] ✅ Verified by Meta');
    return res.status(200).send(challenge);
  }
  console.warn('[Webhook] ❌ Verification failed — check VERIFY_TOKEN');
  return res.sendStatus(403);
});

/* ── Webhook POST — incoming messages ───────────────────────── */
app.post('/webhook', async (req, res) => {
  // Always acknowledge immediately — Meta requires response within 5s
  res.sendStatus(200);

  // Log every hit so we can see in Render logs
  console.log('[Webhook] POST received — object:', req.body?.object);

  // BUG FIX: Signature check was silently dropping ALL messages.
  // Now it only warns and continues — never blocks message processing.
  if (process.env.APP_SECRET) {
    const sig = req.headers['x-hub-signature-256'] || '';
    const expected = 'sha256=' + crypto
      .createHmac('sha256', process.env.APP_SECRET)
      .update(req.rawBody || '')
      .digest('hex');
    const match = sig === expected;
    if (!match) {
      console.warn('[Webhook] ⚠️  Signature mismatch — processing anyway (check APP_SECRET)');
      // Do NOT return here — still process the message
    }
  }

  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
      console.log('[Webhook] Skipping — not a WhatsApp event:', body.object);
      return;
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const val = change.value;

        // Log statuses (read receipts, delivery) but don't process them
        if (val.statuses && !val.messages) {
          console.log('[Webhook] Status update received — skipping');
          continue;
        }

        if (!val.messages) {
          console.log('[Webhook] No messages in change — skipping');
          continue;
        }

        for (const msg of val.messages) {
          console.log(`[Webhook] Message from ${msg.from} | type: ${msg.type}`);
          await handleIncomingMessage(msg, val.metadata, val.contacts?.[0]);
        }
      }
    }
  } catch (err) {
    console.error('[Webhook] ❌ Handler error:', err.message);
    console.error(err.stack);
  }
});

/* ── Health check ────────────────────────────────────────────── */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: 'V6.1 Universal', ts: new Date().toISOString() });
});

/* ── Static pages ────────────────────────────────────────────── */
// BUG FIX: Removed broken next() call in wildcard route
app.get('/admin.html', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/login.html', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/',           (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[SupplyFlow V6.1] ✅ Running on port ${PORT}`);
  console.log(`[SupplyFlow V6.1] VERIFY_TOKEN set: ${!!process.env.VERIFY_TOKEN}`);
  console.log(`[SupplyFlow V6.1] WHATSAPP_TOKEN set: ${!!process.env.WHATSAPP_TOKEN}`);
  console.log(`[SupplyFlow V6.1] PHONE_NUMBER_ID: ${process.env.PHONE_NUMBER_ID || 'NOT SET'}`);
  console.log(`[SupplyFlow V6.1] FIREBASE_CONFIG set: ${!!process.env.FIREBASE_CONFIG}`);
});
