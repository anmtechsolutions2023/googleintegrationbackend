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

const app = express();

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
});
