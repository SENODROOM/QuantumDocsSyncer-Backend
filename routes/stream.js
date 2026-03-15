// routes/stream.js
const router = require("express").Router();
const { addSSEClient, getRecentLogs } = require("../lib/queue");

router.get("/", (req, res) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  // Replay last 50 logs immediately on connect so frontend catches up
  const recent = getRecentLogs().slice(0, 50).reverse();
  recent.forEach(l => {
    try { res.write(`data: ${JSON.stringify(l)}\n\n`); } catch {}
  });

  const remove = addSSEClient(res);
  req.on("close", remove);
});

module.exports = router;