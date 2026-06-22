/**
 * goosAccess.js — GO OS subscription access gate for WhatsApp bots
 *
 * Unlike a web app (checked once on page load), a bot must check on
 * EVERY incoming message. To avoid hammering GO OS, results are cached
 * in-memory per bizId for a short window.
 *
 * bizId here = WhatsApp phone_number_id (Meta's per-business identifier),
 * same value already used throughout dispatcher.js and firestore.js.
 */

const GOOS_SERVER_URL = "https://goos-server.onrender.com"; // live server
const PRODUCT_KEY     = "supplyflow"; // ← ONE product for the whole platform. Each tenant
                                       //   (Nestring, ChemiChemi water, Spin Gas, etc.) is a
                                       //   separate GO OS CLIENT under this same product,
                                       //   identified by their bizId (WhatsApp phone_number_id).

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — bots get many messages, cache aggressively
const _cache = new Map(); // bizId -> { data, ts }

/**
 * Checks access for a given bizId (WhatsApp phone_number_id).
 * Returns { access: bool, reason: string, daysLeft: number|null }
 * FAILS OPEN on any error — a GO OS hiccup never blocks a paying client's bot.
 */
async function checkAccess(bizId) {
  if (!bizId) return { access: true, reason: "no_biz_id_skip_check" };

  const cached = _cache.get(bizId);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const url = `${GOOS_SERVER_URL}/api/access/check?clientId=${encodeURIComponent(bizId)}&productKey=${PRODUCT_KEY}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`GO OS returned ${res.status}`);
    const data = await res.json();
    _cache.set(bizId, { data, ts: Date.now() });
    return data;
  } catch (err) {
    console.warn('[GoOSAccess] check failed, failing OPEN:', err.message);
    const fallback = { access: true, reason: "check_failed_fail_open" };
    // Don't cache failures — retry sooner next message in case GO OS recovers
    return fallback;
  }
}

/**
 * Clears the cached result for a bizId. Call this after confirming a
 * Till payment in GO OS so the bot unblocks instantly instead of
 * waiting up to 5 minutes for the cache to expire naturally.
 * (GO OS already calls /api/access/clear-cache on its own server-side
 * cache — this is the bot's OWN local cache, separate concern.)
 */
function clearCache(bizId) {
  _cache.delete(bizId);
}

module.exports = { checkAccess, clearCache };
