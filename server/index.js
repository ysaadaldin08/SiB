require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  throw new Error('FATAL: CORS_ORIGIN environment variable is not set. ' +
    'Refusing to start in production without an explicit CORS origin.');
}

const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/students');
const employerRoutes = require('./routes/employers');
const postingRoutes = require('./routes/postings');
const applicationRoutes = require('./routes/applications');
const coordinatorRoutes = require('./routes/coordinator');
const notificationRoutes = require('./routes/notifications');
const coordinatorsListRoute = require('./routes/coordinators');
const threadRoutes = require('./routes/threads');
const { authenticate } = require('./middleware/auth');
// server/routes/dev.js was deleted in Phase 7 hardening pass (see SECURITY.md PAF-1)

const app = express();
const PORT = process.env.PORT || 3001;

// Security headers (disables X-Powered-By, sets HSTS, etc.)
app.use(helmet({
  contentSecurityPolicy: false, // CSP is managed via meta tags in HTML; skip header duplication
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// Auth endpoint rate limiting: 5 login attempts per 15 min, 3 registrations per hour per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many sign-in attempts. Please wait 15 minutes before trying again.' }
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "We couldn't create your account right now. Please try again later." }
});

// ── Public routes ─────────────────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter);
app.post('/api/auth/register', registerLimiter);
app.use('/api/auth', authRoutes);

// Postings: GET routes are public; POST/PUT/DELETE authenticate inside the router
app.use('/api/postings', postingRoutes);

// ── Protected routes (require Bearer token) ───────────────────────────────────
app.use('/api/students', authenticate, studentRoutes);
app.use('/api/employers', authenticate, employerRoutes);
app.use('/api/applications', authenticate, applicationRoutes);
app.use('/api/coordinator', coordinatorRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/coordinators', coordinatorsListRoute);
app.use('/api/threads', threadRoutes); // authenticate is applied per-route inside threads.js + messages.js

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// 404 catch-all
app.use((_req, res) => res.status(404).json({ success: false, error: 'Route not found' }));

app.listen(PORT, () => {
  console.log(`SiB API server running at http://localhost:${PORT}`);
});
