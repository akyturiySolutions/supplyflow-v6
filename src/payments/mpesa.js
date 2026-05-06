/**
 * M-Pesa Daraja API — STK Push (Lipa Na M-Pesa Online)
 * Docs: https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
 */

const https = require('https');

function getTimestamp() {
  return new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
}

function getPassword(shortcode, passkey, timestamp) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

async function getAccessToken() {
  const key    = process.env.MPESA_KEY;
  const secret = process.env.MPESA_SECRET;
  const creds  = Buffer.from(`${key}:${secret}`).toString('base64');
  const env    = process.env.MPESA_ENV === 'production' ? 'api' : 'sandbox';

  return new Promise((resolve, reject) => {
    https.get({
      hostname: `${env}.safaricom.co.ke`,
      path: '/oauth/v1/generate?grant_type=client_credentials',
      headers: { Authorization: `Basic ${creds}` }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body).access_token); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function stkPush({ phone, amount, orderId, biz }) {
  const shortcode = biz?.mpesaShortcode || process.env.MPESA_SHORTCODE;
  const passkey   = biz?.mpesaPasskey   || process.env.MPESA_PASSKEY;
  const callbackUrl = `${process.env.APP_URL}/api/mpesa/callback`;
  const env = process.env.MPESA_ENV === 'production' ? 'api' : 'sandbox';

  const token     = await getAccessToken();
  const timestamp = getTimestamp();
  const password  = getPassword(shortcode, passkey, timestamp);

  // Normalize phone: 254XXXXXXXXX
  const normalized = phone.replace(/^\+/, '').replace(/^0/, '254');

  const payload = JSON.stringify({
    BusinessShortCode: shortcode,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   'CustomerBuyGoodsOnline',
    Amount:            Math.ceil(amount),
    PartyA:            normalized,
    PartyB:            biz?.mpesaTill || process.env.MPESA_TILL || shortcode,
    PhoneNumber:       normalized,
    CallBackURL:       callbackUrl,
    AccountReference:  orderId,
    TransactionDesc:   `Order ${orderId}`,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: `${env}.safaricom.co.ke`,
      path:     '/mpesa/stkpush/v1/processrequest',
      method:   'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        const parsed = JSON.parse(body);
        if (parsed.ResponseCode === '0') resolve(parsed);
        else reject(new Error(parsed.errorMessage || 'STK push failed'));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { stkPush, getAccessToken };
