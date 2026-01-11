# Rate Limiting Implementation Guide

## Current Rate Limit Configuration

**Location:** [src/routes/auth.routes.js](src/routes/auth.routes.js)

### Current Settings

```javascript
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
})
```

**Applied to:** `POST /api/auth/google` endpoint

---

## How to Test Rate Limiting

### Method 1: Using cURL (Command Line)

```bash
# Send 6 requests in succession - 6th should fail
for i in {1..6}; do
  curl -X POST http://localhost:3001/api/auth/google \
    -H "Content-Type: application/json" \
    -d '{"id_token":"test_token"}' \
    -w "\nRequest $i - Status: %{http_code}\n"
  sleep 1
done
```

### Method 2: Using Postman

1. Create a POST request to `http://localhost:3001/api/auth/google`
2. Set Body to:

```json
{
  "id_token": "test_token"
}
```

3. Click "Send" button multiple times (6+ times within 15 minutes)
4. After 5 requests, you'll get a 429 status code

### Method 3: Using Node.js Script

Create `test-rate-limit.js`:

```javascript
const http = require('http')

async function testRateLimit() {
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/auth/google',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  }

  for (let i = 1; i <= 8; i++) {
    const req = http.request(options, (res) => {
      console.log(`Request ${i}: Status ${res.statusCode}`)
      console.log(`Rate-Limit-Remaining: ${res.headers['ratelimit-remaining']}`)
      console.log(`Rate-Limit-Reset: ${res.headers['ratelimit-reset']}\n`)
    })

    req.on('error', (e) => {
      console.error(`Request ${i} failed:`, e.message)
    })

    req.write(JSON.stringify({ id_token: 'test_token' }))
    req.end()

    // Small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

testRateLimit()
```

Run with:

```bash
node test-rate-limit.js
```

### Method 4: Using Artillery (Load Testing)

```bash
npm install -g artillery

# Create artillery-config.yml
cat > artillery-config.yml << 'EOF'
config:
  target: "http://localhost:3001"
  phases:
    - duration: 60
      arrivalRate: 1
      name: "Warm up"
scenarios:
  - name: "Test Rate Limit"
    flow:
      - post:
          url: "/api/auth/google"
          json:
            id_token: "test_token"
EOF

artillery run artillery-config.yml
```

---

## Response Headers (What You Get)

When rate limiting is active, you'll see these headers:

```
RateLimit-Limit: 5
RateLimit-Remaining: 4
RateLimit-Reset: 1673000000
```

| Header                | Meaning                              |
| --------------------- | ------------------------------------ |
| `RateLimit-Limit`     | Total requests allowed in window (5) |
| `RateLimit-Remaining` | Requests left before hitting limit   |
| `RateLimit-Reset`     | Unix timestamp when limit resets     |

---

## How It Saves You

### 1. **Prevents Brute Force Attacks** 🔒

- Attackers trying to guess credentials/tokens are limited
- 5 attempts per 15 minutes = ~48 attempts per day per IP
- Makes it economically impractical for attackers

### 2. **Protects Against DoS Attacks** 🛡️

- Reduces server resource consumption
- Prevents single IP from overwhelming the server
- Cost-effective than buying more server capacity

### 3. **Protects Google OAuth** 🔑

- Google invalidates tokens after wrong guesses
- Rate limiting prevents token exhaustion
- Reduces failed Google validation attempts

### 4. **Reduces Database Load** 📊

- Fewer database queries from attack attempts
- Less server CPU usage
- Lower bandwidth consumption

### 5. **Cost Savings** 💰

- Fewer cloud resources needed
- Less database query fees
- Reduced bandwidth costs

---

## Scenarios Where Rate Limit Helps

### Scenario 1: Brute Force Password/Token Attack

```
Attacker trying: /api/auth/google
Request 1: Valid ✓
Request 2: Invalid ✗
Request 3: Invalid ✗
Request 4: Invalid ✗
Request 5: Invalid ✗
Request 6: BLOCKED (429 Too Many Requests) 🚫
```

**Impact:** Attacker must wait 15 minutes to try again

### Scenario 2: Accidental Retry Loop

```
Client bug causes 10 requests/second
Requests 1-5: Processed normally
Requests 6+: Returns 429, stops retry loop
```

**Impact:** Bug caught early, no cascading failures

### Scenario 3: Bot Scanning

```
Malicious bot scanning for endpoints
Limited to 5 attempts per 15 min per IP
After 15 min window: resets, but bot detected
```

**Impact:** Bot activity logged and analyzable

### Scenario 4: Legitimate User Forgot Token

```
User makes 3 failed auth attempts
User fixes issue and succeeds on 4th try
User still has 1 request left before reset
```

**Impact:** User experience not severely impacted

---

## How You Get Notified

### 1. **Response Status Code**

```http
HTTP/1.1 429 Too Many Requests
```

### 2. **Response Body**

```json
{
  "message": "Too many authentication attempts, please try again later."
}
```

### 3. **Response Headers**

```
RateLimit-Limit: 5
RateLimit-Remaining: 0
RateLimit-Reset: 1673000000
```

### 4. **Server Logs**

The logger captures failed requests. Add this to see logs:

```javascript
// In middleware or route handler
console.log('Rate limit hit for IP:', req.ip)
console.log('Remaining requests:', res.get('RateLimit-Remaining'))
```

### 5. **Client-Side Handling**

Your frontend should handle 429:

```javascript
try {
  const response = await fetch('/api/auth/google', { method: 'POST' })

  if (response.status === 429) {
    const resetTime = response.headers.get('RateLimit-Reset')
    const waitSeconds = resetTime * 1000 - Date.now() / 1000
    alert(
      `Too many attempts. Please try again in ${Math.ceil(waitSeconds)} seconds`
    )
  }
} catch (error) {
  console.error('Auth failed:', error)
}
```

---

## Advanced: Customizing Rate Limits

### Different Limits for Different Endpoints

Edit [src/routes/auth.routes.js](src/routes/auth.routes.js):

```javascript
// Stricter limit for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
})

// Looser limit for public info
const infoLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests
})

router.post('/google', loginLimiter, authController.googleAuth)
router.get('/info', infoLimiter, getInfo)
```

### Using Store Instead of Memory

For production, use Redis to share rate limits across multiple server instances:

```bash
npm install rate-limit-redis redis
```

```javascript
const RedisStore = require('rate-limit-redis')
const redis = require('redis')
const client = redis.createClient()

const authLimiter = rateLimit({
  store: new RedisStore({
    client: client,
    prefix: 'rate-limit:',
  }),
  windowMs: 15 * 60 * 1000,
  max: 5,
})
```

---

## Testing Checklist

- [ ] Test normal request (should succeed)
- [ ] Test 5th request (should succeed with Remaining: 0)
- [ ] Test 6th request (should get 429)
- [ ] Wait 15 minutes, test 7th request (should succeed, reset)
- [ ] Test with different IP (should have separate limit)
- [ ] Test response headers contain correct values
- [ ] Test error message is clear to users
- [ ] Monitor server logs for patterns
