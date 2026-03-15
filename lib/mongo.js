// lib/mongo.js
const { MongoClient } = require("mongodb");

let client = null;

async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
  }
  return client.db("qlce");
}

async function logUpdate({ filePath, docPath, status, error, commitSha, triggeredBy }) {
  try {
    const db = await getDb();
    await db.collection("updates").insertOne({
      filePath, docPath, status,
      error: error || null,
      commitSha: commitSha || null,
      triggeredBy: triggeredBy || "webhook",
      timestamp: new Date(),
    });
  } catch (e) { console.error("mongo logUpdate:", e.message); }
}

async function getRecentUpdates(limit = 60) {
  try {
    const db = await getDb();
    return await db.collection("updates").find({}).sort({ timestamp: -1 }).limit(limit).toArray();
  } catch { return []; }
}

async function getStats() {
  try {
    const db = await getDb();
    const [total, success, errors, lastDoc] = await Promise.all([
      db.collection("updates").countDocuments(),
      db.collection("updates").countDocuments({ status: "success" }),
      db.collection("updates").countDocuments({ status: "error" }),
      db.collection("updates").findOne({ status: "success" }, { sort: { timestamp: -1 } }),
    ]);
    return { total, success, errors, lastUpdate: lastDoc?.timestamp || null };
  } catch { return { total: 0, success: 0, errors: 0, lastUpdate: null }; }
}

async function upsertDocIndex(entries) {
  try {
    const db = await getDb();
    const ops = entries.map(e => ({
      updateOne: {
        filter: { filePath: e.filePath },
        update: { $set: { ...e, updatedAt: new Date() } },
        upsert: true,
      },
    }));
    if (ops.length) await db.collection("doc_index").bulkWrite(ops);
  } catch (e) { console.error("mongo upsertDocIndex:", e.message); }
}

async function getDocIndex() {
  try {
    const db = await getDb();
    return await db.collection("doc_index").find({}).toArray();
  } catch { return []; }
}

// Keep track of live processing jobs for SSE streaming
const jobs = [];
function addJob(entry) { jobs.unshift(entry); if (jobs.length > 200) jobs.pop(); }
function getJobs() { return jobs; }

module.exports = { logUpdate, getRecentUpdates, getStats, upsertDocIndex, getDocIndex, addJob, getJobs };
