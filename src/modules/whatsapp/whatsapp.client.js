// src/modules/whatsapp/whatsapp.client.js
// The only place the WhatsApp access token is read.
//
// Everything that talks to Meta goes through here, for two reasons: the token
// has exactly one place it can leak from, and every other module can be tested
// without a network by mocking this one file.
//
// ── What a caller gets back ────────────────────────────────────────────────
// A RESULT, never an exception, for anything Meta says. A failed send is an
// ordinary outcome of the login flow — the number has no WhatsApp account, the
// template got paused, we hit a rate limit — and each of those needs a
// different response to the user. Throwing would collapse them into one.
//
// Only a programming error (missing configuration) throws.
//
// See WHATSAPP_IDENTITY_MIGRATION.md §8.

const config = require('../../config/config');
const { logger } = require('../../utils/logger');
const { maskForLog } = require('../../utils/phone');

const WA = config.WHATSAPP;

/** Meta error codes the caller must be able to tell apart. See §8.3. */
const ERRORS = {
  UNDELIVERABLE: 131026,   // usually: the number has no WhatsApp account
  PARAM_MISMATCH: 132000,  // almost always the missing button parameter
  TEMPLATE_MISSING: 132001,// wrong name, or 'en' where the template is 'en_US'
  NUMBER_NOT_REGISTERED: 133010,
  TOKEN_INVALID: 190,
  RATE_LIMITED_A: 80007,
  RATE_LIMITED_B: 130429,
};

/** True for failures that are ours to fix, not the user's. */
const isInfrastructureFailure = (code) =>
  Number(code) !== ERRORS.UNDELIVERABLE;

const graphUrl = (path) =>
  `${WA.GRAPH_BASE_URL}/${WA.GRAPH_VERSION}/${path}`;

const assertConfigured = () => {
  const missing = ['ACCESS_TOKEN', 'PHONE_NUMBER_ID'].filter((k) => !WA[k]);
  if (missing.length) {
    // A programming/deployment error, not a user outcome — this one throws.
    throw new Error(`WhatsApp is not configured: missing ${missing.join(', ')}`);
  }
};

/**
 * Calls the Graph API and normalises the answer.
 *
 * Meta returns 200 with a body, or non-200 with { error: { code, message } }.
 * A network failure or timeout is neither, and must not look like a rejected
 * message — the caller has to know it can retry.
 */
const call = async (url, init) => {
  let res;
  let body;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(WA.SEND_TIMEOUT_MS),
    });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    // Timeout or transport failure. Deliberately not given a Meta error code:
    // nothing about the message was rejected, we never got an answer.
    logger.error('WhatsApp request failed before a reply', { error: err.message });
    return { ok: false, transportError: true, errorMessage: err.message };
  }

  if (!res.ok || body.error) {
    const error = body.error || {};
    return {
      ok: false,
      status: res.status,
      errorCode: error.code != null ? String(error.code) : String(res.status),
      errorSubcode: error.error_subcode ?? null,
      errorMessage: error.message || `HTTP ${res.status}`,
    };
  }

  return { ok: true, body };
};

/**
 * Sends the one-time code as an Authentication template.
 *
 * The code goes in TWICE — once in the body, once on the copy-code button. The
 * button carries its own copy because that is what lands on the clipboard, and
 * sending only the body returns a parameter error rather than anything
 * readable. See §8.2.
 *
 * @param {string} phoneE164 - Recipient, E.164 with the leading plus.
 * @param {string} code - The plaintext code. NEVER logged, here or anywhere.
 * @returns {Promise<{ok: boolean, wamid?: string, errorCode?: string, ...}>}
 */
const sendOtp = async (phoneE164, code) => {
  assertConfigured();

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    // Meta accepts the number with or without the plus; sent as stored.
    to: phoneE164,
    type: 'template',
    template: {
      name: WA.TEMPLATE_OTP_NAME,
      language: { code: WA.TEMPLATE_OTP_LANG },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', parameter_name: 'code', text: code }],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: code }],
        },
      ],
    },
  };

  const result = await call(graphUrl(`${WA.PHONE_NUMBER_ID}/messages`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WA.ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!result.ok) {
    // The number is masked and the code never appears. An axios-style error
    // object would have serialised the Authorization header; this is why the
    // failure is rebuilt by hand rather than logged wholesale.
    logger.warn('WhatsApp OTP send rejected', {
      phone: maskForLog(phoneE164),
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      infrastructure: isInfrastructureFailure(result.errorCode),
    });
    return result;
  }

  // A 200 means Meta ACCEPTED it, not that it arrived. Delivery is
  // asynchronous and only the webhook can confirm it.
  const wamid = result.body?.messages?.[0]?.id ?? null;
  logger.info('WhatsApp OTP accepted by Meta', {
    phone: maskForLog(phoneE164), wamid,
  });
  return { ok: true, wamid };
};

/**
 * Is the OTP template still usable?
 *
 * Meta can pause or reject a template after approval. Login depends on it, so
 * this is checked at boot and on a schedule — the alternative is finding out
 * from a manager at the till. See §8, "operational".
 */
const getTemplateStatus = async () => {
  assertConfigured();
  if (!WA.BUSINESS_ACCOUNT_ID) {
    return { ok: false, errorMessage: 'WA_BUSINESS_ACCOUNT_ID is not set' };
  }

  const url = graphUrl(
    `${WA.BUSINESS_ACCOUNT_ID}/message_templates?name=${encodeURIComponent(WA.TEMPLATE_OTP_NAME)}`,
  );
  const result = await call(url, {
    headers: { Authorization: `Bearer ${WA.ACCESS_TOKEN}` },
  });
  if (!result.ok) return result;

  const match = (result.body?.data || []).find(
    (t) => t.name === WA.TEMPLATE_OTP_NAME && t.language === WA.TEMPLATE_OTP_LANG,
  );
  return {
    ok: true,
    found: !!match,
    status: match?.status ?? null,
    approved: match?.status === 'APPROVED',
  };
};

/**
 * Quality rating of the sending number.
 *
 * With Google retired this is a leading indicator of a total login outage:
 * Meta throttles numbers whose rating falls, so alert on the transition rather
 * than on the first failed send.
 */
const getNumberHealth = async () => {
  assertConfigured();
  const url = graphUrl(
    `${WA.PHONE_NUMBER_ID}?fields=verified_name,quality_rating,code_verification_status,throughput`,
  );
  const result = await call(url, {
    headers: { Authorization: `Bearer ${WA.ACCESS_TOKEN}` },
  });
  if (!result.ok) return result;
  return { ok: true, ...result.body };
};

module.exports = {
  sendOtp,
  getTemplateStatus,
  getNumberHealth,
  isInfrastructureFailure,
  ERRORS,
};
