// server.js
// Main entry point for the Google Integration Backend server.
// Handles Express app setup, middleware, routes, and server startup.

require('dotenv').config() // Load environment variables once here
const express = require('express')
const cors = require('cors')
const config = require('./src/config/config')
const { errorHandler } = require('./src/middleware/errorHandler')
const { logger } = require('./src/utils/logger')
const MESSAGES = require('./src/config/messages')
const { PORT } = require('./src/config/envConfig')

const authRoutes = require('./src/routes/auth.routes')
const protectedRoutes = require('./src/routes/protected.routes')

const app = express()

// Middleware setup
app.use(cors())
app.use(express.json())

// Routes
app.use('/api/auth', authRoutes)
app.use('/api', protectedRoutes)

app.get('/', (req, res) => {
  res.send(MESSAGES.INFO.AUTH_SERVER_RUNNING)
})

// Final error handling middleware
app.use(errorHandler)

app.listen(PORT, () => {
  logger.info(`${MESSAGES.INFO.SERVER_RUNNING}${PORT}`)
})
