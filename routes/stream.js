// routes/stream.js
const router = require("express").Router();
const { addSSEClient } = require("../lib/queue");

router.get("/", (req, res) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();
  const remove = addSSEClient(res);
  req.on("close", remove);
});

module.exports = router;
