// server.js
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { errorHandler } = require('./src/middleware/errorHandler')

const authRoutes = require('./src/routes/auth.routes')
const protectedRoutes = require('./src/routes/protected.routes')

const app = express()
const PORT = process.env.PORT || 5000

// Middleware setup
app.use(cors())
app.use(express.json())

// Routes
app.use('/api/auth', authRoutes)
app.use('/api', protectedRoutes)

app.get('/', (req, res) => {
  res.send('Authorization Server Running.')
})

// Final error handling middleware
app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`\nServer is running on port ${PORT}`)
})
