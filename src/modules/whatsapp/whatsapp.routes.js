// src/modules/whatsapp/whatsapp.routes.js
// The WhatsApp webhook. NOT behind authenticateToken — Meta has no user.
// Its signature check is its authentication; see whatsapp.webhook.controller.

const express = require('express');
const router = express.Router();
const controller = require('./whatsapp.webhook.controller');

// Captures the exact bytes alongside the parsed body. `verify` runs before
// parsing completes, which is the only hook that sees the raw buffer — and the
// signature is computed over those bytes, not over a re-serialisation of the
// parsed object.
const rawJson = express.json({
  limit: '256kb',
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
});

router.get('/', controller.verifyWebhook);
router.post('/', rawJson, controller.receiveWebhook);

module.exports = router;
