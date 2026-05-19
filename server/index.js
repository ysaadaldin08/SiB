require('dotenv').config();
const express = require('express');
const cors = require('cors');

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
if (process.env.NODE_ENV === 'development') {
  const devRoutes = require('./routes/dev');
  // Registered below after app is created
  var _devRoutes = devRoutes;
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// ── Public routes ─────────────────────────────────────────────────────────────
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

// ── Dev-only routes (NODE_ENV=development) ────────────────────────────────────
if (typeof _devRoutes !== 'undefined') app.use('/api/dev/seed', _devRoutes);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// 404 catch-all
app.use((_req, res) => res.status(404).json({ success: false, error: 'Route not found' }));

app.listen(PORT, () => {
  console.log(`SiB API server running at http://localhost:${PORT}`);
});
