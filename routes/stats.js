// routes/stats.js
const router = require("express").Router();
const { Update, DocIndex } = require("../lib/models");
const { getQueueSize, isProcessing } = require("../lib/queue");

router.get("/", async (req, res) => {
  try {
    const { type } = req.query;
    if (type === "history") {
      return res.json({ updates: await Update.find().sort({ timestamp: -1 }).limit(100).lean() });
    }
    if (type === "index") {
      return res.json({ index: await DocIndex.find().sort({ updatedAt: -1 }).lean() });
    }
    const [total, success, errors, lastDoc, recent] = await Promise.all([
      Update.countDocuments(),
      Update.countDocuments({ status: "success" }),
      Update.countDocuments({ status: "error" }),
      Update.findOne({ status: "success" }).sort({ timestamp: -1 }).lean(),
      Update.find().sort({ timestamp: -1 }).limit(20).lean(),
    ]);
    res.json({ stats: { total, success, errors, lastUpdate: lastDoc?.timestamp || null }, recent, queue: getQueueSize(), running: isProcessing() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
