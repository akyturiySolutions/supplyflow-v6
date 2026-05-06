/**
 * Auth routes — simple token-based login for admin dashboard
 */

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@supplyflow.app';
  const adminPass  = process.env.ADMIN_PASSWORD || 'changeme';

  if (email === adminEmail && password === adminPass) {
    // In production: use JWT or Firebase Auth
    res.json({ ok: true, token: process.env.ADMIN_TOKEN || 'dev-token' });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

router.post('/logout', (_req, res) => res.json({ ok: true }));

module.exports = router;
