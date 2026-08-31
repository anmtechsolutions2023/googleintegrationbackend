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
const { registerRoutes } = require('./src/config/routes');
const { assertSchemaIsCurrent } = require('./src/config/schemaCheck');

const app = express();

// Serverless platforms and reverse proxies terminate TLS and forward the real
// client IP in X-Forwarded-For. Without this, express-rate-limit refuses to read
// that header (ERR_ERL_FORWARDED_HEADER) and every rate-limited route throws.
// 1 = trust exactly one hop, the platform's own proxy; trusting all hops would
// let a caller spoof the header and dodge the limiter.
app.set('trust proxy', 1);

// Middleware setup
app.use(cors());
app.use(express.json());

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

app.listen(PORT, () => {
  logger.info(`${MESSAGES.INFO.SERVER_RUNNING}${PORT}`);
  // Deliberately after listen and deliberately not awaited: this reports a
  // stale database, it does not gate the service on one.
  assertSchemaIsCurrent();
});
