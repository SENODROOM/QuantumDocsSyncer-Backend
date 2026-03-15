// routes/webhook.js
const router = require("express").Router();
const crypto = require("crypto");
const { getChangedFiles } = require("../lib/github");
const { enqueue } = require("../lib/queue");

router.post("/", async (req, res) => {
  const sig    = req.headers["x-hub-signature-256"];
  const secret = process.env.WEBHOOK_SECRET || "quantum_webhook_secret_2024";
  if (sig) {
    const expected = `sha256=${crypto.createHmac("sha256", secret).update(JSON.stringify(req.body)).digest("hex")}`;
    try {
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)))
        return res.status(401).json({ error: "Bad signature" });
    } catch { return res.status(401).json({ error: "Bad signature" }); }
  }

  const event = req.headers["x-github-event"];
  if (event !== "push") return res.json({ message: `Ignored: ${event}` });

  const { commits, head_commit } = req.body;
  if (!commits?.length) return res.json({ message: "No commits" });

  const commitSha = head_commit?.id || "unknown";
  const changed   = await getChangedFiles(commits); // already scoped to src/ + include/
  const queued    = enqueue(changed, commitSha, "webhook");

  res.json({ message: "Webhook received", commitSha, fileCount: queued });
});

module.exports = router;
