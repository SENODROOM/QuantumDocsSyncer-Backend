// lib/github.js
const { Octokit } = require("@octokit/rest");

const oc   = () => new Octokit({ auth: process.env.GITHUB_TOKEN });
const SRC  = () => ({ owner: process.env.GITHUB_SOURCE_OWNER, repo: process.env.GITHUB_SOURCE_REPO,  branch: process.env.GITHUB_SOURCE_BRANCH || "main" });
const DOCS = () => ({ owner: process.env.GITHUB_DOCS_OWNER,   repo: process.env.GITHUB_DOCS_REPO,    branch: process.env.GITHUB_DOCS_BRANCH   || "main" });

// ── Scope: only src/ and include/ ────────────────────────────────────────────
function isInScope(filePath) {
  return filePath.startsWith("src/") || filePath.startsWith("include/");
}

// ── Doc path mapping ─────────────────────────────────────────────────────────
// include/AST/AST.h        → include/AST/README.md
// include/Lexer/Lexer.h    → include/Lexer/README.md
// src/lexer/Lexer.cpp      → src/lexer/Lexer.cpp.md
// src/main/main.cpp        → src/main/main.cpp.md
function toDocPath(filePath) {
  const parts    = filePath.split("/");
  const fileName = parts[parts.length - 1];
  const ext      = fileName.split(".").pop().toLowerCase();
  const dir      = parts.slice(0, -1).join("/");

  if (ext === "h") {
    // Header → README.md in the same folder
    return dir ? `${dir}/README.md` : "README.md";
  }
  if (ext === "cpp") {
    // Source → <name>.cpp.md beside the file
    return dir ? `${dir}/${fileName}.md` : `${fileName}.md`;
  }
  // Anything else → append .md
  return `${filePath}.md`;
}

// ── Fetch a source file from Quantum-Language ─────────────────────────────────
async function fetchFileContent(filePath) {
  try {
    const s = SRC();
    const r = await oc().repos.getContent({ owner: s.owner, repo: s.repo, path: filePath, ref: s.branch });
    return Buffer.from(r.data.content, "base64").toString("utf8");
  } catch (e) {
    console.error(`fetchFileContent(${filePath}): ${e.message}`);
    return null;
  }
}

// ── All files in src/ + include/ ─────────────────────────────────────────────
async function getAllRepoFiles() {
  try {
    const s = SRC();
    const r = await oc().git.getTree({ owner: s.owner, repo: s.repo, tree_sha: s.branch, recursive: "1" });
    return r.data.tree
      .filter(i => i.type === "blob" && isInScope(i.path))
      .map(i => i.path);
  } catch (e) {
    console.error("getAllRepoFiles:", e.message);
    return [];
  }
}

// ── Changed files from a push event (scoped) ─────────────────────────────────
async function getChangedFiles(commits) {
  const set = new Set();
  for (const c of commits) {
    [...(c.added || []), ...(c.modified || [])].forEach(f => {
      if (isInScope(f)) set.add(f);
    });
  }
  return [...set];
}

// ── Read existing doc from docs repo ─────────────────────────────────────────
async function readDocFile(docPath) {
  try {
    const d = DOCS();
    const r = await oc().repos.getContent({ owner: d.owner, repo: d.repo, path: docPath, ref: d.branch });
    return Buffer.from(r.data.content, "base64").toString("utf8");
  } catch { return null; }
}

// ── Write doc to a specific branch ───────────────────────────────────────────
async function writeDocFileToBranch(docPath, content, branchName) {
  const d = DOCS();
  const o = oc();
  let sha;
  try {
    const ex = await o.repos.getContent({ owner: d.owner, repo: d.repo, path: docPath, ref: branchName });
    sha = ex.data.sha;
  } catch { /* new file */ }

  await o.repos.createOrUpdateFileContents({
    owner: d.owner, repo: d.repo, path: docPath,
    message: `docs: update ${docPath}`,
    content: Buffer.from(content).toString("base64"),
    branch: branchName,
    ...(sha ? { sha } : {}),
  });
}

// ── Write directly to main (single file) ─────────────────────────────────────
async function writeDocFile(docPath, content) {
  return writeDocFileToBranch(docPath, content, DOCS().branch);
}

// ── Create a branch in docs repo off main ────────────────────────────────────
async function createDocsBranch(branchName) {
  const d   = DOCS();
  const o   = oc();
  const ref = await o.git.getRef({ owner: d.owner, repo: d.repo, ref: `heads/${d.branch}` });
  await o.git.createRef({ owner: d.owner, repo: d.repo, ref: `refs/heads/${branchName}`, sha: ref.data.object.sha });
}

// ── Check branch exists ───────────────────────────────────────────────────────
async function docsBranchExists(branchName) {
  try {
    const d = DOCS();
    await oc().git.getRef({ owner: d.owner, repo: d.repo, ref: `heads/${branchName}` });
    return true;
  } catch { return false; }
}

// ── Open a pull request ───────────────────────────────────────────────────────
async function createPullRequest({ branchName, title, body }) {
  const d = DOCS();
  const r = await oc().pulls.create({
    owner: d.owner, repo: d.repo,
    title, body, head: branchName, base: d.branch,
  });
  return r.data.html_url;
}

module.exports = {
  isInScope, toDocPath,
  fetchFileContent, getAllRepoFiles, getChangedFiles,
  readDocFile, writeDocFile, writeDocFileToBranch,
  createDocsBranch, docsBranchExists, createPullRequest,
};
