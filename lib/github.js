// lib/github.js
const { Octokit } = require("@octokit/rest");

const oc   = () => new Octokit({ auth: process.env.GITHUB_TOKEN });
const SRC  = () => ({ owner: process.env.GITHUB_SOURCE_OWNER, repo: process.env.GITHUB_SOURCE_REPO,  branch: process.env.GITHUB_SOURCE_BRANCH || "main" });
const DOCS = () => ({ owner: process.env.GITHUB_DOCS_OWNER,   repo: process.env.GITHUB_DOCS_REPO,    branch: process.env.GITHUB_DOCS_BRANCH   || "main" });

function isInScope(filePath) {
  return filePath.startsWith("src/") || filePath.startsWith("include/");
}

// ── Doc path mapping matching code-explanation structure ──────────────────────
//
// include/AST/AST.h          → include/AST/README.md
// include/Lexer/Lexer.h      → include/Lexer/README.md
//
// src/Interpreter.cpp        → src/Interpreter.cpp.md  (top-level summary)
//                           AND src/interpreter/README.md
//                           AND src/interpreter/Evaluate/evalBinary.md  etc.
//
// src/Lexer.cpp              → src/Lexer.cpp.md
//                           AND src/lexer/README.md
//                           AND src/lexer/advance.md  etc.
//
// src/Parser.cpp             → src/Parser.cpp.md + src/parser/*.md
// src/Token.cpp              → src/Token.cpp.md + src/token/README.md
// src/TypeChecker.cpp        → src/TypeChecker.cpp.md + src/typechecker/README.md
// src/Value.cpp              → src/Value.cpp.md + src/value/*.md
// src/main.cpp               → src/main.cpp.md + src/main/*.md

function toDocPath(filePath) {
  const parts    = filePath.split("/");
  const fileName = parts[parts.length - 1];
  const ext      = fileName.split(".").pop().toLowerCase();
  const dir      = parts.slice(0, -1).join("/");
  const baseName = fileName.replace(/\.[^.]+$/, ""); // without extension

  if (ext === "h") {
    return dir ? `${dir}/README.md` : "README.md";
  }
  if (ext === "cpp") {
    // Top-level summary file e.g. src/Interpreter.cpp.md
    return dir ? `${dir}/${fileName}.md` : `${fileName}.md`;
  }
  return `${filePath}.md`;
}

// Returns all doc paths that should be generated for a source file
// For .cpp files this includes the summary AND the per-function breakdown files
function getDocPathsForFile(filePath) {
  const parts    = filePath.split("/");
  const fileName = parts[parts.length - 1];
  const ext      = fileName.split(".").pop().toLowerCase();
  const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();

  if (ext === "h") {
    return [toDocPath(filePath)];
  }

  if (ext === "cpp") {
    const summaryPath = toDocPath(filePath);

    // Map cpp file to its breakdown folder
    // src/Interpreter.cpp → src/interpreter/
    // src/Lexer.cpp        → src/lexer/
    // src/main.cpp         → src/main/
    const breakdownDir = `src/${baseName}`;

    return { summaryPath, breakdownDir, baseName };
  }

  return [toDocPath(filePath)];
}

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

async function getChangedFiles(commits) {
  const set = new Set();
  for (const c of commits) {
    [...(c.added || []), ...(c.modified || [])].forEach(f => {
      if (isInScope(f)) set.add(f);
    });
  }
  return [...set];
}

async function readDocFile(docPath) {
  try {
    const d = DOCS();
    const r = await oc().repos.getContent({ owner: d.owner, repo: d.repo, path: docPath, ref: d.branch });
    return Buffer.from(r.data.content, "base64").toString("utf8");
  } catch { return null; }
}

async function writeDocFileToBranch(docPath, content, branchName) {
  const d = DOCS();
  const o = oc();
  let sha;
  try {
    const ex = await o.repos.getContent({ owner: d.owner, repo: d.repo, path: docPath, ref: branchName });
    sha = ex.data.sha;
  } catch {}
  await o.repos.createOrUpdateFileContents({
    owner: d.owner, repo: d.repo, path: docPath,
    message: `docs: update ${docPath}`,
    content: Buffer.from(content).toString("base64"),
    branch: branchName,
    ...(sha ? { sha } : {}),
  });
}

async function writeDocFile(docPath, content) {
  return writeDocFileToBranch(docPath, content, DOCS().branch);
}

async function createDocsBranch(branchName) {
  const d = DOCS(), o = oc();
  const ref = await o.git.getRef({ owner: d.owner, repo: d.repo, ref: `heads/${d.branch}` });
  await o.git.createRef({ owner: d.owner, repo: d.repo, ref: `refs/heads/${branchName}`, sha: ref.data.object.sha });
}

async function docsBranchExists(branchName) {
  try {
    const d = DOCS();
    await oc().git.getRef({ owner: d.owner, repo: d.repo, ref: `heads/${branchName}` });
    return true;
  } catch { return false; }
}

async function createPullRequest({ branchName, title, body }) {
  const d = DOCS();
  const r = await oc().pulls.create({
    owner: d.owner, repo: d.repo,
    title, body, head: branchName, base: d.branch,
  });
  return r.data.html_url;
}

module.exports = {
  isInScope, toDocPath, getDocPathsForFile,
  fetchFileContent, getAllRepoFiles, getChangedFiles,
  readDocFile, writeDocFile, writeDocFileToBranch,
  createDocsBranch, docsBranchExists, createPullRequest,
};