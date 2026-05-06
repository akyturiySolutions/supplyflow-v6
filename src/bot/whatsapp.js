/**
 * WhatsApp Cloud API — low-level send helpers
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */

const https = require('https');

const BASE = 'https://graph.facebook.com/v19.0';

function getToken() {
  return process.env.WHATSAPP_TOKEN;
}

/** Raw POST to WhatsApp API */
async function apiPost(phoneNumberId, body) {
  const url = `${BASE}/${phoneNumberId}/messages`;
  const data = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        const parsed = JSON.parse(body);
        if (res.statusCode >= 400) {
          console.error('[WA API Error]', parsed);
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/** Send a plain text message */
async function sendMessage(phoneNumberId, to, text) {
  return apiPost(phoneNumberId, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: text }
  });
}

/** Send an interactive message (buttons or list) */
async function sendInteractive(phoneNumberId, to, interactive) {
  return apiPost(phoneNumberId, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive
  });
}

/** Send a template message (for transactional notifications) */
async function sendTemplate(phoneNumberId, to, templateName, langCode, components = []) {
  return apiPost(phoneNumberId, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: langCode || 'en_US' },
      components
    }
  });
}

/** Mark a message as read */
async function markRead(phoneNumberId, messageId) {
  return apiPost(phoneNumberId, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId
  });
}

/** Send an image by URL */
async function sendImage(phoneNumberId, to, imageUrl, caption = '') {
  return apiPost(phoneNumberId, {
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: { link: imageUrl, caption }
  });
}

/** Send a document (e.g. PDF invoice) */
async function sendDocument(phoneNumberId, to, docUrl, filename, caption = '') {
  return apiPost(phoneNumberId, {
    messaging_product: 'whatsapp',
    to,
    type: 'document',
    document: { link: docUrl, filename, caption }
  });
}

/** Request user location */
async function requestLocation(phoneNumberId, to, bodyText) {
  return apiPost(phoneNumberId, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'location_request_message',
      body: { text: bodyText },
      action: { name: 'send_location' }
    }
  });
}

module.exports = { sendMessage, sendInteractive, sendTemplate, markRead, sendImage, sendDocument, requestLocation };
