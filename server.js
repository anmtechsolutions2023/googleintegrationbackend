// server.js
// Main entry point for the Google Integration Backend server.
// Handles Express app setup, middleware, routes, and server startup.

require('dotenv').config(); // Load environment variables once here
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./src/config/swagger');
const { errorHandler } = require('./src/middleware/errorHandler');
const { logger } = require('./src/utils/logger');
const MESSAGES = require('./src/config/messages');
const { PORT } = require('./src/config/envConfig');
const config = require('./src/config/config');
const { registerRoutes } = require('./src/config/routes');
const { assertSchemaIsCurrent } = require('./src/config/schemaCheck');
const whatsappHealth = require('./src/modules/whatsapp/whatsapp.health');

const app = express();

// Serverless platforms and reverse proxies terminate TLS and forward the real
// client IP in X-Forwarded-For. Without this, express-rate-limit refuses to read
// that header (ERR_ERL_FORWARDED_HEADER) and every rate-limited route throws.
// 1 = trust exactly one hop, the platform's own proxy; trusting all hops would
// let a caller spoof the header and dodge the limiter.
app.set('trust proxy', 1);

// Middleware setup
// maxAge lets the browser cache the preflight instead of paying for an extra
// (potentially cold) OPTIONS invocation ahead of every JSON POST. See
// config.CORS.PREFLIGHT_MAX_AGE_S for why this is worth a line of config.
app.use(cors({ maxAge: config.CORS.PREFLIGHT_MAX_AGE_S }));
// Body parsing — with a deliberate hole for webhooks.
//
// A webhook's signature is an HMAC over the EXACT bytes that arrived. Capturing
// those needs express.json's `verify` hook, and `verify` only fires for the
// parser that actually consumes the stream: a second express.json() sees
// req._body already set and short-circuits, leaving req.rawBody undefined.
//
// So a global parser in front of a webhook router silently disables its
// signature check. The portal webhook fails closed in that state (an absent raw
// body refuses), which turns it into a rejected-every-request bug rather than a
// hole — but it is still a bug, and the WhatsApp webhook would inherit it.
//
// Each webhook router therefore does its own parsing, and is skipped here.
const RAW_BODY_PREFIXES = ['/api/webhooks/', '/api/pos/portal-webhooks'];
const jsonParser = express.json();
app.use((req, res, next) => {
  if (RAW_BODY_PREFIXES.some((prefix) => req.path.startsWith(prefix))) return next();
  return jsonParser(req, res, next);
});

// Swagger UI — browse at http://localhost:3001/api-docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  swaggerOptions: {
    persistAuthorization: true,
  },
  customSiteTitle: 'Google Integration Backend API',
}));

// Register all routes
registerRoutes(app);

// Final error handling middleware
app.use(errorHandler);

// Sign-in depends entirely on WhatsApp, so a misconfigured deployment is a
// total outage rather than a degraded one. In production that must stop the
// process here, where it is one line in a deploy log, rather than surfacing as
// a 500 to the first person trying to open the till.
//
// Not strict elsewhere: a developer without Meta credentials still needs a
// server, and `npm run admin:token` is how they get a session.
whatsappHealth.check({ strict: process.env.NODE_ENV === 'production' })
  .catch((err) => logger.warn('WhatsApp health check failed', { error: err.message }));

app.listen(PORT, () => {
  logger.info(`${MESSAGES.INFO.SERVER_RUNNING}${PORT}`);
  // Deliberately after listen and deliberately not awaited: this reports a
  // stale database, it does not gate the service on one.
  assertSchemaIsCurrent();
});
