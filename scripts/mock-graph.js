#!/usr/bin/env node
// scripts/mock-graph.js
// A stand-in for graph.facebook.com, so local development can sign in with no
// internet and without spending money.
//
// ── Why this exists ────────────────────────────────────────────────────────
// Sign-in is WhatsApp one-time codes and nothing else, and every code is a
// billed authentication conversation. Testing a login flow locally therefore
// costs real money and needs a working connection to Meta — on a train, that
// is the whole application unusable.
//
// This answers the THREE endpoints whatsapp.client.js calls, in the shapes it
// parses, and prints the code to this terminal instead of sending it.
//
// ── What it deliberately is not ────────────────────────────────────────────
// It is not a bypass. The application's send path is untouched: real HTTP, real
// AbortSignal timeout, real Meta error parsing. Nothing in src/ branches on
// NODE_ENV to skip a send. The only difference is WHERE the request goes, and
// config.js refuses to honour that redirect in production at all.
//
// It is dev tooling: nothing in src/ imports it, and it never ships.
//
//   npm run mock:graph
//
// Then set WA_GRAPH_BASE_URL=http://localhost:4000 in your LOCAL .env only.

const express = require('express');

const PORT = Number(process.env.MOCK_GRAPH_PORT) || 4000;
const app = express();
app.use(express.json({ limit: '1mb' }));

// Set MOCK_GRAPH_FAIL to a Meta error code to exercise a failure branch that
// otherwise only ever happens in production — 131026 is "this number has no
// WhatsApp account", which the OTP service turns into a 400 rather than a
// retryable 502. Unset for the normal happy path.
const FAIL_CODE = process.env.MOCK_GRAPH_FAIL;

const banner = (to, code) => {
  const line = '─'.repeat(34);
  console.log(`\n  ┌${line}┐`);
  console.log(`  │  to    ${to}`);
  console.log(`  │  CODE  ${code}`);
  console.log(`  └${line}┘\n`);
};

/**
 * Sending a template message.
 * whatsapp.client reads `body.messages[0].id` as the wamid.
 * The code rides in the FIRST body component's parameters — see the payload
 * built in whatsapp.client.sendOtp.
 */
app.post('/:version/:phoneNumberId/messages', (req, res) => {
  const to = req.body?.to ?? '(unknown)';
  const code = req.body?.template?.components?.[0]?.parameters?.[0]?.text ?? '(not found)';

  if (FAIL_CODE) {
    console.log(`  ✗ returning Meta error ${FAIL_CODE} for ${to}`);
    // Meta's failure shape: non-200 with { error: { code, message } }.
    return res.status(400).json({
      error: { code: Number(FAIL_CODE), message: `Mock failure ${FAIL_CODE}` },
    });
  }

  banner(to, code);
  return res.json({
    messaging_product: 'whatsapp',
    contacts: [{ input: to, wa_id: String(to).replace('+', '') }],
    messages: [{ id: `wamid.MOCK${Date.now()}` }],
  });
});

/**
 * Template status — the boot check.
 * whatsapp.client looks for a row in `body.data` whose `name` AND `language`
 * both match, then asserts status === 'APPROVED'. Echoing the requested name
 * and language back is what makes that match succeed for any configured
 * template rather than only the seeded one.
 *
 * Declared BEFORE the bare '/:version/:phoneNumberId' below: Express matches in
 * declaration order, and the wildcard would otherwise swallow this path.
 */
app.get('/:version/:wabaId/message_templates', (req, res) => {
  const name = req.query.name || 'login_otp';
  console.log(`  · template status asked for "${name}" → APPROVED`);
  res.json({
    data: [{
      name,
      language: process.env.WA_TEMPLATE_OTP_LANG || 'en_US',
      status: 'APPROVED',
      category: 'AUTHENTICATION',
    }],
  });
});

/**
 * Number health — the other boot check. Whatever comes back is spread onto the
 * result, so the field names have to match what the health log reads.
 */
app.get('/:version/:phoneNumberId', (req, res) => {
  console.log('  · number health asked → GREEN');
  res.json({
    verified_name: 'Local Mock Number',
    quality_rating: 'GREEN',
    code_verification_status: 'VERIFIED',
    throughput: { level: 'STANDARD' },
  });
});

// Anything else is a genuine mismatch between this mock and the client. Say so
// loudly rather than answering 404 into a timeout nobody can explain.
app.use((req, res) => {
  console.log(`  ! UNHANDLED ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: { code: 404, message: `mock-graph has no handler for ${req.method} ${req.path}` },
  });
});

app.listen(PORT, () => {
  console.log(`\n  Mock Graph API listening on http://localhost:${PORT}`);
  console.log('  Set WA_GRAPH_BASE_URL to that in your LOCAL .env only.');
  if (FAIL_CODE) console.log(`  MOCK_GRAPH_FAIL=${FAIL_CODE} — sends will be refused.`);
  console.log('  Login codes will print here.\n');
});
