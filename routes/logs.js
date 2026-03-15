// routes/logs.js
const router = require("express").Router();
const { getRecentLogs } = require("../lib/queue");

router.get("/", (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 10000);
  const all   = getRecentLogs();
  const logs  = all.filter(l => new Date(l.ts) > since);
  res.json({ logs, ts: new Date().toISOString() });
});

module.exports = router;