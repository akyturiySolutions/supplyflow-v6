/**
 * Firestore DB Layer
 *
 * Production: uses Firebase Admin SDK (set FIREBASE_CONFIG env var).
 * Development / no Firebase: falls back to in-process Maps so the bot
 * still runs end-to-end without a real DB.
 *
 * PATCHED:
 *  - BUG 4: getDailyStats wraps orderBy in try/catch — if the Firestore
 *    composite index doesn't exist yet, it falls back to client-side sort
 *    instead of crashing. The error message includes the index creation URL.
 *
 * Collections used:
 *   businesses  — business config (products, branding, payment keys)
 *   orders      — order records
 *   clients     — registered customer profiles
 *   analytics   — aggregated daily stats
 */

let db = null;

unction initFirestore() {
  if (db) return db;
  try {
    const admin = require('firebase-admin');

    // Method 1: Three separate env vars (most reliable on Render)
    const projectId   = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '')
                          .replace(/\\n/g, '\n');

    // Method 2: Full JSON fallback
    let credential;
    if (projectId && clientEmail && privateKey) {
      console.log('[Firestore] Using individual env vars');
      console.log('[Firestore] project_id:', projectId);
      console.log('[Firestore] client_email:', clientEmail);
      credential = admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      });
    } else {
      console.log('[Firestore] Using FIREBASE_CONFIG JSON');
      const raw    = process.env.FIREBASE_CONFIG || '{}';
      const config = JSON.parse(raw);
      if (config.private_key) {
        config.private_key = config.private_key.replace(/\\n/g, '\n');
      }
      console.log('[Firestore] project_id:', config.project_id);
      credential = admin.credential.cert(config);
    }

    if (!admin.apps.length) {
      admin.initializeApp({ credential });
      console.log('[Firestore] ✅ Firebase initialized');
    }

    db = admin.firestore();
    console.log('[Firestore] ✅ Firestore connected');

  } catch (err) {
    console.error('[Firestore] ❌ Error:', err.message);
    db = null;
  }
  return db;
}

/* ── In-memory fallback (single-instance dev/demo) ─────────── */
const _mem = {
  businesses: new Map(),
  orders:     new Map(),
  clients:    new Map(),
  analytics:  new Map(),
};

/* ── Helpers ────────────────────────────────────────────────── */
async function fsGet(collection, id) {
  const fs = initFirestore();
  if (fs) {
    const snap = await fs.collection(collection).doc(id).get();
    return snap.exists ? snap.data() : null;
  }
  return _mem[collection]?.get(id) || null;
}

async function fsSet(collection, id, data, merge = true) {
  const fs = initFirestore();
  if (fs) {
    await fs.collection(collection).doc(id).set({ ...data, updatedAt: Date.now() }, { merge });
  } else {
    _mem[collection] = _mem[collection] || new Map();
    _mem[collection].set(id, {
      ...(_mem[collection].get(id) || {}),
      ...data,
      updatedAt: Date.now()
    });
  }
}

async function fsQuery(collection, field, op, value, limit = 50) {
  const fs = initFirestore();
  if (fs) {
    const snap = await fs.collection(collection).where(field, op, value).limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  const map     = _mem[collection] || new Map();
  const results = [];
  for (const [id, doc] of map.entries()) {
    if (op === '==' && doc[field] === value) results.push({ id, ...doc });
    if (results.length >= limit) break;
  }
  return results;
}

/* ── Business Config ────────────────────────────────────────── */
const _bizCache = new Map();

async function getBusinessConfig(bizId) {
  if (_bizCache.has(bizId)) return _bizCache.get(bizId);
  console.log('[Firestore] Looking up bizId:', bizId);
  const biz    = await fsGet('businesses', bizId);
  console.log('[Firestore] Result:', biz ? biz.name : 'NOT FOUND — using defaults');
  const result = biz || getDefaultBizConfig(bizId);
  _bizCache.set(bizId, result);
  setTimeout(() => _bizCache.delete(bizId), 5 * 60 * 1000);
  return result;
}

async function saveBusinessConfig(bizId, config) {
  await fsSet('businesses', bizId, config);
  _bizCache.delete(bizId);
}

function getDefaultBizConfig(bizId) {
  return {
    id:             bizId,
    name:           process.env.BIZ_NAME      || 'SupplyFlow Business',
    sector:         process.env.BIZ_SECTOR    || 'water',
    greeting:       process.env.BIZ_GREETING  || null,
    mpesaTill:      process.env.MPESA_TILL    || '',
    mpesaShortcode: process.env.MPESA_SHORTCODE || '',
    supportPhone:   process.env.SUPPORT_PHONE || '',
    products:       null,
    currency:       'KES',
  };
}

/* ── Orders ─────────────────────────────────────────────────── */
async function saveOrder({ orderId, session, total, status, biz }) {
  const order = {
    orderId,
    bizId:           session.bizId,
    customerPhone:   session.from,
    customerName:    session.name,
    cart:            session.cart,
    total,
    status,
    deliveryAddress: session.pendingAddr || '',
    location:        session.location   || null,
    createdAt:       Date.now(),
    updatedAt:       Date.now(),
  };
  await fsSet('orders', orderId, order, false);
  await upsertClient(session.from, { name: session.name, lastOrderAt: Date.now(), bizId: session.bizId });
  await incrementDailyStat(session.bizId, 'ordersCount', 1);
  await incrementDailyStat(session.bizId, 'revenue', total);
  return order;
}

async function getOrder(orderId) {
  return fsGet('orders', orderId);
}

async function updateOrderStatus(orderId, status, extra = {}) {
  // Filter out undefined/null extras
  const clean = {};
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null) clean[k] = v;
  }
  await fsSet('orders', orderId, { status, ...clean });
}

async function getOrdersByBiz(bizId, limit = 100) {
  return fsQuery('orders', 'bizId', '==', bizId, limit);
}

/* ── Clients ─────────────────────────────────────────────────── */
async function upsertClient(phone, data) {
  const existing   = (await fsGet('clients', phone)) || {};
  const orderCount = (existing.orderCount || 0) + (data.orderCount !== undefined ? data.orderCount : 1);
  // Only increment orderCount once per saveOrder call
  await fsSet('clients', phone, { ...existing, ...data, phone, orderCount: existing.orderCount !== undefined ? existing.orderCount + 1 : 1 });
}

async function getClients(bizId, limit = 200) {
  return fsQuery('clients', 'bizId', '==', bizId, limit);
}

/* ── Analytics ──────────────────────────────────────────────── */
async function incrementDailyStat(bizId, field, amount) {
  const today = new Date().toISOString().slice(0, 10);
  const key   = `${bizId}_${today}`;
  const stat  = (await fsGet('analytics', key)) || { bizId, date: today };
  stat[field] = (stat[field] || 0) + amount;
  await fsSet('analytics', key, stat);
}

/**
 * BUG 4 FIX: getDailyStats previously used orderBy which requires a
 * composite Firestore index. If that index doesn't exist, Firestore
 * throws an error with an index-creation URL. We now catch that and
 * fall back to client-side sorting, so the app never crashes.
 */
async function getDailyStats(bizId, days = 30) {
  const fs = initFirestore();

  if (fs) {
    try {
      // Try the efficient server-side ordered query first
      const snap = await fs.collection('analytics')
        .where('bizId', '==', bizId)
        .orderBy('date', 'desc')
        .limit(days)
        .get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      // Index not yet created — Firestore error message contains the creation URL
      if (err.code === 9 || (err.message || '').includes('index')) {
        console.warn(
          '[Firestore] Missing composite index for analytics orderBy date.\n' +
          'Create it at: https://console.firebase.google.com/project/_/firestore/indexes\n' +
          'Fields: bizId (ASC), date (DESC)\n' +
          'Falling back to client-side sort.'
        );
        // Fallback: fetch without orderBy, sort in memory
        const snap2 = await fs.collection('analytics')
          .where('bizId', '==', bizId)
          .limit(days * 2) // fetch more to compensate for no server sort
          .get();
        return snap2.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
          .slice(0, days);
      }
      throw err;
    }
  }

  // In-memory fallback
  const map     = _mem.analytics || new Map();
  const results = [];
  for (const [id, doc] of map.entries()) {
    if (doc.bizId === bizId) results.push({ id, ...doc });
  }
  return results
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, days);
}

module.exports = {
  getBusinessConfig, saveBusinessConfig,
  saveOrder, getOrder, updateOrderStatus, getOrdersByBiz,
  getClients, upsertClient,
  getDailyStats, incrementDailyStat,
};
