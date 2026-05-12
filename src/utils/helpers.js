/**
 * Shared utility functions
 *
 * PATCHED:
 *  - BUG 5: sanitise() added — strips HTML/script tags from user input
 *    before storage or rendering (prevents XSS in admin dashboard)
 */

let _counter = 1000;

function generateOrderId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  _counter++;
  return `ORD-${date}-${_counter}`;
}

function formatKES(amount) {
  return `KES ${Number(amount).toLocaleString('en-KE')}`;
}

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function truncate(str, max = 72) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function normalizePhone(phone) {
  return phone.replace(/^\+/, '').replace(/^0/, '254');
}

/**
 * sanitise — strips HTML tags and dangerous characters from
 * user-provided strings (delivery addresses, notes) before storing
 * or rendering in the admin dashboard, preventing stored XSS.
 */
function sanitise(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/<[^>]*>/g, '')        // strip HTML tags
    .replace(/[<>"'`]/g, '')        // strip remaining dangerous chars
    .replace(/javascript:/gi, '')   // strip JS URIs
    .trim()
    .slice(0, 300);                 // hard length cap
}

module.exports = { generateOrderId, formatKES, slugify, truncate, normalizePhone, sanitise };
