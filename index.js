require("dotenv").config();

const express  = require("express");
const cors     = require("cors");
const mongoose = require("mongoose");

const app = express();

app.use(cors({ origin: "*", methods: ["GET","POST","OPTIONS"], allowedHeaders: ["Content-Type","Authorization"] }));
app.use(express.json());

app.use("/api/stats",   require("./routes/stats"));
app.use("/api/trigger", require("./routes/trigger"));
app.use("/api/webhook", require("./routes/webhook"));

// SSE doesn't work on Vercel serverless — replaced with polling endpoint
// Frontend polls /api/logs every 3 seconds instead
app.use("/api/logs",   require("./routes/logs"));
app.use("/api/stream", require("./routes/stream")); // kept for local dev

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
    app.listen(PORT, () => console.log(`\n✓ QuantumDocsSyncer → http://localhost:${PORT}\n`));
  })
  .catch(err => { console.error("MongoDB error:", err.message); process.exit(1); });

module.exports = app;