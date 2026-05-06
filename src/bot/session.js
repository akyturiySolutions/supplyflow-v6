/**
 * Session Store
 * Default: in-process Map (works for single-instance deployments).
 * Production: swap the Map for Redis (see commented code below).
 *
 * Session TTL: 30 minutes of inactivity.
 *
 * Schema (all optional fields depending on step):
 * {
 *   from:        string,   // WhatsApp phone number
 *   name:        string,   // Customer display name
 *   bizId:       string,   // Which business this session belongs to
 *   step:        string,   // Current conversation state
 *   cart:        Array,    // [{ productId, name, qty, unitPrice }]
 *   orderId:     string,   // After order is created
 *   location:    object,   // { latitude, longitude, name, address }
 *   pendingAddr: string,   // Typed delivery address
 *   paymentRef:  string,   // M-Pesa / manual ref
 *   lastActivity:number,   // timestamp for TTL
 * }
 */

const TTL_MS = 30 * 60 * 1000; // 30 minutes

// ── In-memory store ──────────────────────────────────────────────
const store = new Map();

function pruneExpired() {
  const cutoff = Date.now() - TTL_MS;
  for (const [key, val] of store.entries()) {
    if ((val.lastActivity || 0) < cutoff) store.delete(key);
  }
}

// Prune every 5 minutes
setInterval(pruneExpired, 5 * 60 * 1000);

async function getSession(phone) {
  const s = store.get(phone);
  if (!s) return null;
  if (Date.now() - (s.lastActivity || 0) > TTL_MS) {
    store.delete(phone);
    return null;
  }
  return s;
}

async function setSession(phone, data) {
  store.set(phone, { ...data, lastActivity: Date.now() });
}

async function clearSession(phone) {
  store.delete(phone);
}

module.exports = { getSession, setSession, clearSession };

/* ── Redis swap-in (uncomment + npm i ioredis) ──────────────────
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

async function getSession(phone) {
  const raw = await redis.get(`session:${phone}`);
  return raw ? JSON.parse(raw) : null;
}
async function setSession(phone, data) {
  await redis.setex(`session:${phone}`, 1800, JSON.stringify({ ...data, lastActivity: Date.now() }));
}
async function clearSession(phone) {
  await redis.del(`session:${phone}`);
}
*/
