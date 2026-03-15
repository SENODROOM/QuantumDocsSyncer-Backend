// lib/queue.js
const {
  fetchFileContent, readDocFile, writeDocFileToBranch,
  createDocsBranch, docsBranchExists, createPullRequest,
  toDocPath, isInScope,
} = require("./github");
const {
  generateExplanation, generateFunctionDoc, generateReadme,
  extractFunctions, getCppBreakdownDir, getSubfolder,
} = require("./huggingface");
const { Update, DocIndex } = require("./models");

const SKIP_EXT = new Set(["png","jpg","jpeg","gif","ico","svg","woff","woff2",
  "ttf","eot","pdf","zip","tar","gz","lock","log","md"]);

function shouldProcess(filePath) {
  if (!isInScope(filePath)) return false;
  return !SKIP_EXT.has(filePath.split(".").pop().toLowerCase());
}

// ── SSE ──────────────────────────────────────────────────────────────────────
const sseClients = [];
const recentLogs = [];

function broadcast(entry) {
  recentLogs.unshift(entry);
  if (recentLogs.length > 300) recentLogs.pop();
  const msg = `data: ${JSON.stringify(entry)}\n\n`;
  sseClients.forEach(r => { try { r.write(msg); } catch {} });
}

function log(level, filePath, message) {
  const entry = { level, filePath: filePath || null, message, ts: new Date().toISOString() };
  broadcast(entry);
  console.log(`[${level.toUpperCase()}]`, filePath || "", message);
  return entry;
}

function addSSEClient(res) {
  sseClients.push(res);
  recentLogs.slice(0, 30).reverse().forEach(l => {
    try { res.write(`data: ${JSON.stringify(l)}\n\n`); } catch {}
  });
  return () => {
    const i = sseClients.indexOf(res);
    if (i !== -1) sseClients.splice(i, 1);
  };
}

let queue     = [];
let isRunning = false;
let queueSize = 0;
let running   = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Process a .h file → include/*/README.md ───────────────────────────────────
async function processHeaderFile(filePath, branchName, commitSha, triggeredBy) {
  const docPath = toDocPath(filePath); // e.g. include/AST/README.md
  log("info", filePath, "generating header explanation…");

  const content = await fetchFileContent(filePath);
  if (!content || content.trim().length < 20) {
    log("skip", filePath, "empty");
    await Update.create({ filePath, docPath, status:"skipped", error:"too small", commitSha, triggeredBy });
    return "skipped";
  }

  const existing = await readDocFile(docPath);
  let explanation;
  try {
    explanation = await generateExplanation(filePath, content, existing);
  } catch(e) {
    log("error", filePath, `HF error: ${e.message}`);
    await Update.create({ filePath, docPath, status:"error", error:e.message, commitSha, triggeredBy });
    if (e.message.includes("429")) { log("warn", null, "Rate limited 30s"); await sleep(30000); }
    return "error";
  }

  await writeDocFileToBranch(docPath, explanation, branchName);
  await Update.create({ filePath, docPath, status:"success", commitSha, triggeredBy });
  await DocIndex.findOneAndUpdate({ filePath }, { filePath, docPath, lastCommitSha: commitSha, updatedAt: new Date() }, { upsert:true, new:true });
  log("success", filePath, `✓ ${docPath}`);
  return "success";
}

// ── Process a .cpp file → summary + per-function breakdowns ──────────────────
async function processCppFile(filePath, branchName, commitSha, triggeredBy) {
  const summaryDocPath = toDocPath(filePath); // e.g. src/Interpreter.cpp.md

  log("info", filePath, "fetching source…");
  const content = await fetchFileContent(filePath);
  if (!content || content.trim().length < 20) {
    log("skip", filePath, "empty");
    return "skipped";
  }

  // 1. Generate top-level summary
  log("info", filePath, "generating summary…");
  const existingSummary = await readDocFile(summaryDocPath);
  try {
    const summary = await generateExplanation(filePath, content, existingSummary);
    await writeDocFileToBranch(summaryDocPath, summary, branchName);
    await Update.create({ filePath, docPath: summaryDocPath, status:"success", commitSha, triggeredBy });
    await DocIndex.findOneAndUpdate({ filePath }, { filePath, docPath: summaryDocPath, lastCommitSha: commitSha, updatedAt: new Date() }, { upsert:true, new:true });
    log("success", filePath, `✓ ${summaryDocPath}`);
  } catch(e) {
    log("error", filePath, `Summary HF error: ${e.message}`);
    await Update.create({ filePath, docPath: summaryDocPath, status:"error", error:e.message, commitSha, triggeredBy });
    if (e.message.includes("429")) { await sleep(30000); }
  }

  await sleep(2500);

  // 2. Generate per-function breakdown docs
  const { dir: breakdownDir, subfolders } = getCppBreakdownDir(filePath);
  const functions = extractFunctions(content);

  log("info", filePath, `found ${functions.length} functions — generating breakdowns in ${breakdownDir}/`);

  const generatedFiles = [];

  for (const fn of functions) {
    const subfolder = getSubfolder(fn.name, subfolders);
    const docPath   = subfolder
      ? `${breakdownDir}/${subfolder}/${fn.name}.md`
      : `${breakdownDir}/${fn.name}.md`;

    log("info", filePath, `  → ${docPath}`);
    const existing = await readDocFile(docPath);

    try {
      const doc = await generateFunctionDoc(filePath, fn.name, fn.code, existing);
      await writeDocFileToBranch(docPath, doc, branchName);
      await Update.create({ filePath, docPath, status:"success", commitSha, triggeredBy });
      generatedFiles.push(fn.name);
      log("success", filePath, `  ✓ ${fn.name}`);
    } catch(e) {
      log("error", filePath, `  ✗ ${fn.name}: ${e.message}`);
      await Update.create({ filePath, docPath, status:"error", error:e.message, commitSha, triggeredBy });
      if (e.message.includes("429")) { await sleep(30000); }
    }

    await sleep(2500);
  }

  // 3. Update the directory README.md
  if (functions.length > 0) {
    const readmePath = `${breakdownDir}/README.md`;
    const existingReadme = await readDocFile(readmePath);
    const dirName = breakdownDir.split("/").pop();

    try {
      log("info", filePath, `updating ${readmePath}…`);
      const readme = await generateReadme(dirName, generatedFiles, existingReadme);
      await writeDocFileToBranch(readmePath, readme, branchName);
      log("success", filePath, `✓ ${readmePath}`);
    } catch(e) {
      log("error", filePath, `README error: ${e.message}`);
    }

    await sleep(2500);
  }

  return "success";
}

// ── Process one file ──────────────────────────────────────────────────────────
async function processOne(filePath, branchName, commitSha, triggeredBy) {
  const ext = filePath.split(".").pop().toLowerCase();
  if (ext === "h")   return processHeaderFile(filePath, branchName, commitSha, triggeredBy);
  if (ext === "cpp") return processCppFile(filePath, branchName, commitSha, triggeredBy);

  // Other files — simple summary
  const docPath = toDocPath(filePath);
  log("info", filePath, "generating explanation…");
  const content = await fetchFileContent(filePath);
  if (!content || content.trim().length < 20) {
    await Update.create({ filePath, docPath, status:"skipped", error:"too small", commitSha, triggeredBy });
    return "skipped";
  }
  const existing = await readDocFile(docPath);
  try {
    const doc = await generateExplanation(filePath, content, existing);
    await writeDocFileToBranch(docPath, doc, branchName);
    await Update.create({ filePath, docPath, status:"success", commitSha, triggeredBy });
    await DocIndex.findOneAndUpdate({ filePath }, { filePath, docPath, lastCommitSha: commitSha, updatedAt: new Date() }, { upsert:true, new:true });
    log("success", filePath, `✓ ${docPath}`);
    return "success";
  } catch(e) {
    log("error", filePath, `HF error: ${e.message}`);
    await Update.create({ filePath, docPath, status:"error", error:e.message, commitSha, triggeredBy });
    if (e.message.includes("429")) await sleep(30000);
    return "error";
  }
}

// ── Batch: create branch → process all → open PR ─────────────────────────────
async function runBatch(files, commitSha, triggeredBy) {
  const ts         = Date.now();
  const shortSha   = commitSha ? commitSha.slice(0,7) : "manual";
  const branchName = `docs/auto-${shortSha}-${ts}`;

  log("queue", null, `Creating branch: ${branchName}`);
  try { await createDocsBranch(branchName); }
  catch(e) { if (!(await docsBranchExists(branchName))) { log("error", null, `Branch failed: ${e.message}`); return; } }

  const results   = { success:0, error:0, skipped:0 };
  const succeeded = [];

  for (const filePath of files) {
    queueSize = Math.max(0, queueSize - 1);
    broadcast({ level:"queue_size", size: queueSize });
    const result = await processOne(filePath, branchName, commitSha, triggeredBy);
    results[result] = (results[result] || 0) + 1;
    if (result === "success") succeeded.push(filePath);
  }

  if (succeeded.length > 0) {
    log("info", null, `Opening PR for ${succeeded.length} source file(s)…`);
    const fileList = succeeded.map(f => `- \`${f}\``).join("\n");
    try {
      const prUrl = await createPullRequest({
        branchName,
        title: `docs: update ${succeeded.length} file(s) [${shortSha}]`,
        body: `## Automated Documentation Update\n\nTriggered by: ${triggeredBy}\n\n### Files\n\n${fileList}\n\n---\n*Generated by QuantumDocsSyncer*`,
      });
      log("pr", null, `PR opened → ${prUrl}`);
      broadcast({ level:"pr", url:prUrl, fileCount:succeeded.length, ts:new Date().toISOString() });
    } catch(e) { log("error", null, `PR failed: ${e.message}`); }
  }

  log("queue", null, `Batch done — ✓${results.success} ✗${results.error} skip${results.skipped}`);
}

async function runQueue() {
  if (isRunning) return;
  isRunning = true; running = true;
  broadcast({ level:"running", value:true });

  while (queue.length > 0) {
    const batch = queue.splice(0, queue.length);
    broadcast({ level:"queue_size", size:0 });
    const groups = {};
    for (const job of batch) {
      const key = `${job.commitSha||"manual"}::${job.triggeredBy}`;
      if (!groups[key]) groups[key] = { files:[], commitSha:job.commitSha, triggeredBy:job.triggeredBy };
      groups[key].files.push(job.filePath);
    }
    for (const g of Object.values(groups)) {
      log("queue", null, `Batch: ${g.files.length} files (${g.triggeredBy})`);
      await runBatch(g.files, g.commitSha, g.triggeredBy);
    }
  }

  isRunning = false; running = false; queueSize = 0;
  broadcast({ level:"running", value:false });
  log("queue", null, "Queue finished");
  broadcast({ level:"queue_size", size:0 });
}

function enqueue(files, commitSha, triggeredBy) {
  const valid = files.filter(shouldProcess);
  valid.forEach(f => queue.push({ filePath:f, commitSha:commitSha||null, triggeredBy:triggeredBy||"manual" }));
  queueSize += valid.length;
  broadcast({ level:"queue_size", size:queueSize });
  runQueue().catch(console.error);
  return valid.length;
}

function getQueueSize()  { return queueSize; }
function isProcessing()  { return running; }
function getRecentLogs() { return recentLogs; }

module.exports = { enqueue, addSSEClient, getQueueSize, isProcessing, shouldProcess, getRecentLogs };