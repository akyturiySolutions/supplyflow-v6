const crypto = require('crypto');

function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

module.exports = { verifySignature, generateToken };
