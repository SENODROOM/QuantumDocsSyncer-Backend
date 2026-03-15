// routes/logs.js
// Polling endpoint — replaces SSE for Vercel compatibility
// Frontend calls GET /api/logs?since=<timestamp> every 3 seconds
const router = require("express").Router();
const { getRecentLogs } = require("../lib/queue");

router.get("/", (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 10000);
  const logs  = getRecentLogs().filter(l => new Date(l.ts) > since);
  res.json({ logs, ts: new Date().toISOString() });
});

module.exports = router;