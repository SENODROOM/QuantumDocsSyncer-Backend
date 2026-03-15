// lib/github.js
const { Octokit } = require("@octokit/rest");

function getOctokit() {
  return new Octokit({ auth: process.env.GITHUB_TOKEN });
}

const SOURCE = () => ({
  owner: process.env.GITHUB_SOURCE_OWNER || "SENODROOM",
  repo:  process.env.GITHUB_SOURCE_REPO  || "Quantum-Language",
  branch: process.env.GITHUB_SOURCE_BRANCH || "main",
});

const DOCS = () => ({
  owner: process.env.GITHUB_DOCS_OWNER || "SENODROOM",
  repo:  process.env.GITHUB_DOCS_REPO  || "QuantumLangCodeExplaination",
  branch: process.env.GITHUB_DOCS_BRANCH || "main",
});

async function fetchFileContent(filePath) {
  try {
    const src = SOURCE();
    const octokit = getOctokit();
    const res = await octokit.repos.getContent({
      owner: src.owner, repo: src.repo,
      path: filePath, ref: src.branch,
    });
    return Buffer.from(res.data.content, "base64").toString("utf8");
  } catch (e) {
    console.error(`fetchFileContent(${filePath}):`, e.message);
    return null;
  }
}

async function getAllRepoFiles() {
  try {
    const src = SOURCE();
    const octokit = getOctokit();
    const res = await octokit.git.getTree({
      owner: src.owner, repo: src.repo,
      tree_sha: src.branch, recursive: "1",
    });
    return res.data.tree
      .filter(i => i.type === "blob")
      .map(i => i.path);
  } catch (e) {
    console.error("getAllRepoFiles:", e.message);
    return [];
  }
}

async function writeDocFile(docPath, content) {
  const docs = DOCS();
  const octokit = getOctokit();
  let sha;
  try {
    const existing = await octokit.repos.getContent({
      owner: docs.owner, repo: docs.repo,
      path: docPath, ref: docs.branch,
    });
    sha = existing.data.sha;
  } catch { /* new file */ }

  await octokit.repos.createOrUpdateFileContents({
    owner: docs.owner, repo: docs.repo,
    path: docPath,
    message: `docs: auto-update ${docPath}`,
    content: Buffer.from(content).toString("base64"),
    branch: docs.branch,
    ...(sha ? { sha } : {}),
  });
}

async function readDocFile(docPath) {
  try {
    const docs = DOCS();
    const octokit = getOctokit();
    const res = await octokit.repos.getContent({
      owner: docs.owner, repo: docs.repo,
      path: docPath, ref: docs.branch,
    });
    return Buffer.from(res.data.content, "base64").toString("utf8");
  } catch { return null; }
}

async function getChangedFiles(commits) {
  const set = new Set();
  for (const c of commits) {
    [...(c.added||[]), ...(c.modified||[])].forEach(f => set.add(f));
  }
  return [...set];
}

module.exports = { fetchFileContent, getAllRepoFiles, writeDocFile, readDocFile, getChangedFiles };
