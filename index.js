// index.js — QuantumDocsSyncer Backend
require("dotenv").config();

const express  = require("express");
const cors     = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || "*" }));
app.use(express.json());

// Routes
app.use("/api/stream",  require("./routes/stream"));
app.use("/api/stats",   require("./routes/stats"));
app.use("/api/trigger", require("./routes/trigger"));
app.use("/api/webhook", require("./routes/webhook"));

app.get("/api/health", (req, res) => {
  const { getQueueSize, isProcessing } = require("./lib/queue");
  res.json({ status: "ok", service: "QuantumDocsSyncer", queue: getQueueSize(), running: isProcessing() });
});

app.get("/", (req, res) => res.json({ service: "QuantumDocsSyncer API", status: "ok" }));

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✓ MongoDB connected");
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`\n✓ QuantumDocsSyncer backend → http://localhost:${PORT}`);
      console.log(`  Scoping to: src/ and include/ folders only`);
      console.log(`  HF model: mistralai/Mistral-7B-Instruct-v0.3:hf-inference`);
      console.log(`  Docs repo: ${process.env.GITHUB_DOCS_OWNER}/${process.env.GITHUB_DOCS_REPO}\n`);
    });
  })
  .catch(err => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });
