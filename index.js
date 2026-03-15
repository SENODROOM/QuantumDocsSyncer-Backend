require("dotenv").config();

const express  = require("express");
const mongoose = require("mongoose");

const app = express();

// ── CORS — must be FIRST, before everything else ──────────────────────────────
// Handle preflight OPTIONS requests immediately
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Max-Age",       "86400");

  // Respond to preflight immediately — don't pass to Express router
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/stats",   require("./routes/stats"));
app.use("/api/trigger", require("./routes/trigger"));
app.use("/api/webhook", require("./routes/webhook"));
app.use("/api/logs",    require("./routes/logs"));
app.use("/api/stream",  require("./routes/stream"));

app.get("/api/health", (req, res) => {
  const { getQueueSize, isProcessing } = require("./lib/queue");
  res.json({ status: "ok", service: "QuantumDocsSyncer", queue: getQueueSize(), running: isProcessing() });
});

app.get("/", (req, res) => {
  res.json({ service: "QuantumDocsSyncer API", status: "ok" });
});

// ── Start ─────────────────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✓ MongoDB connected");
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`\n✓ QuantumDocsSyncer → http://localhost:${PORT}\n`));
  })
  .catch(err => { console.error("MongoDB error:", err.message); process.exit(1); });

module.exports = app;