// server.js  — QuantumLangCodeExplaination Backend
require("dotenv").config();

const express = require("express");
const crypto  = require("crypto");
const cors    = require("cors");

const { fetchFileContent, getAllRepoFiles, writeDocFile, readDocFile, getChangedFiles } = require("./lib/github");
const { generateExplanation } = require("./lib/huggingface");
const { logUpdate, getRecentUpdates, getStats, upsertDocIndex, getDocIndex, addJob, getJobs } = require("./lib/mongo");

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());

// ── SSE clients list (for live log streaming) ───────────────────────────────
const sseClients = [];

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => { try { res.write(msg); } catch {} });
}

function log(level, filePath, message) {
  const entry = { level, filePath, message, ts: new Date().toISOString() };
  addJob(entry);
  broadcast(entry);
  console.log(`[${level.toUpperCase()}] ${filePath || ""} ${message}`);
}

// ── Skip rules ──────────────────────────────────────────────────────────────
const SKIP_EXT = new Set(["png","jpg","jpeg","gif","ico","svg","woff","woff2",
  "ttf","eot","pdf","zip","tar","gz","lock","log","md"]);
const SKIP_DIR = ["node_modules/",".git/","dist/","build/"];

function shouldProcess(p) {
  const ext = p.split(".").pop().toLowerCase();
  if (SKIP_EXT.has(ext)) return false;
  if (SKIP_DIR.some(d => p.startsWith(d))) return false;
  return true;
}

function toDocPath(filePath) { return `${filePath}.md`; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Core: process one file ──────────────────────────────────────────────────
async function processFile(filePath, commitSha = null, triggeredBy = "webhook") {
  const docPath = toDocPath(filePath);

  log("info", filePath, "fetching source...");
  const content = await fetchFileContent(filePath);
  if (!content || content.trim().length < 20) {
    log("skip", filePath, "empty or too small");
    await logUpdate({ filePath, docPath, status: "skipped", error: "too small", commitSha, triggeredBy });
    return "skipped";
  }

  log("info", filePath, "generating explanation...");
  const existing = await readDocFile(docPath);

  let explanation;
  try {
    explanation = await generateExplanation(filePath, content, existing);
  } catch (e) {
    log("error", filePath, `HF error: ${e.message}`);
    await logUpdate({ filePath, docPath, status: "error", error: e.message, commitSha, triggeredBy });
    if (e.message.includes("429")) {
      log("warn", filePath, "rate limited — waiting 30s");
      await sleep(30000);
    }
    return "error";
  }

  log("info", filePath, "writing to docs repo...");
  await writeDocFile(docPath, explanation);
  await logUpdate({ filePath, docPath, status: "success", commitSha, triggeredBy });
  await upsertDocIndex([{ filePath, docPath, lastCommitSha: commitSha }]);
  log("success", filePath, "done ✓");
  return "success";
}

// ── Background queue ────────────────────────────────────────────────────────
let isRunning = false;
const queue = [];

async function runQueue() {
  if (isRunning) return;
  isRunning = true;
  broadcast({ level: "queue", message: `Starting — ${queue.length} files queued` });

  while (queue.length > 0) {
    const { filePath, commitSha, triggeredBy } = queue.shift();
    await processFile(filePath, commitSha, triggeredBy);
    await sleep(2200); // HF rate limit buffer
  }

  isRunning = false;
  broadcast({ level: "queue", message: "Queue finished" });
}

function enqueue(files, commitSha, triggeredBy) {
  files.forEach(f => queue.push({ filePath: f, commitSha, triggeredBy }));
  runQueue().catch(console.error);
}

// ── Routes ──────────────────────────────────────────────────────────────────

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "QuantumLangCodeExplaination", queue: queue.length, running: isRunning });
});

// ── SSE: live log stream ────────────────────────────────────────────────────
app.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  // Send last 20 recent jobs on connect
  getJobs().slice(0, 20).reverse().forEach(j => {
    res.write(`data: ${JSON.stringify(j)}\n\n`);
  });

  sseClients.push(res);
  req.on("close", () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

// ── Stats ───────────────────────────────────────────────────────────────────
app.get("/stats", async (req, res) => {
  const { type } = req.query;
  try {
    if (type === "history")  return res.json({ updates: await getRecentUpdates(100) });
    if (type === "index")    return res.json({ index: await getDocIndex() });
    const [stats, recent] = await Promise.all([getStats(), getRecentUpdates(20)]);
    res.json({ stats, recent, queue: queue.length, running: isRunning });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Manual trigger ──────────────────────────────────────────────────────────
app.post("/trigger", async (req, res) => {
  const { files, all } = req.body || {};

  let toProcess = [];
  if (all) {
    const allFiles = await getAllRepoFiles();
    toProcess = allFiles.filter(shouldProcess);
  } else if (Array.isArray(files) && files.length) {
    toProcess = files.filter(shouldProcess);
  } else {
    return res.status(400).json({ error: "Provide { files: [...] } or { all: true }" });
  }

  enqueue(toProcess, null, "manual");
  res.json({ message: "Queued", fileCount: toProcess.length, queueTotal: queue.length });
});

// ── GitHub webhook ──────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  // Verify signature
  const sig = req.headers["x-hub-signature-256"];
  const secret = process.env.WEBHOOK_SECRET || "quantum_webhook_secret_2024";
  if (sig) {
    const expected = `sha256=${crypto.createHmac("sha256", secret).update(JSON.stringify(req.body)).digest("hex")}`;
    try {
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
        return res.status(401).json({ error: "Bad signature" });
      }
    } catch { return res.status(401).json({ error: "Bad signature" }); }
  }

  const event = req.headers["x-github-event"];
  if (event !== "push") return res.json({ message: `Ignored: ${event}` });

  const { commits, head_commit } = req.body;
  if (!commits?.length) return res.json({ message: "No commits" });

  const commitSha = head_commit?.id || "unknown";
  const changed = await getChangedFiles(commits);
  const toProcess = changed.filter(shouldProcess);

  log("info", null, `Webhook: push ${commitSha.slice(0,7)} — ${toProcess.length} files to process`);
  enqueue(toProcess, commitSha, "webhook");

  res.json({ message: "Webhook received", commitSha, fileCount: toProcess.length });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✓ QuantumLangCodeExplaination backend running on http://localhost:${PORT}\n`);
});

module.exports = app;
