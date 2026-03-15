// lib/huggingface.js
const MODEL  = "Qwen/Qwen2.5-Coder-7B-Instruct";
const HF_URL = "https://router.huggingface.co/v1/chat/completions";

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildSummaryPrompt(filePath, code, existing) {
  const ext = filePath.split(".").pop();
  const ctx = existing ? `\n\nExisting summary (update if needed):\n${existing.slice(0, 400)}\n---\n` : "";
  return `You are a C++ compiler documentation expert.

Write a detailed README.md summary for this file from the Quantum Language compiler.

File: ${filePath}${ctx}
\`\`\`${ext}
${code.slice(0, 3000)}
\`\`\`

Cover: role in compiler pipeline, key design decisions and WHY, major classes/functions overview, tradeoffs.
Clean markdown, # heading first, no excessive emojis.`;
}

function buildFunctionPrompt(filePath, funcName, funcCode, existing) {
  const ctx = existing ? `\n\nExisting doc (update if needed):\n${existing.slice(0, 300)}\n---\n` : "";
  return `You are a C++ compiler documentation expert.

Write a detailed markdown explanation for this specific function/method from the Quantum Language compiler.

File: ${filePath}
Function: ${funcName}${ctx}
\`\`\`cpp
${funcCode.slice(0, 2000)}
\`\`\`

Cover: what it does, WHY it works this way, parameters/return value, edge cases, interactions with other components.
Start with # ${funcName}, clean markdown, no excessive emojis.`;
}

function buildReadmePrompt(dirName, files, existing) {
  const ctx = existing ? `\n\nExisting README (update if needed):\n${existing.slice(0, 400)}\n---\n` : "";
  return `You are a C++ compiler documentation expert.

Write a README.md for the ${dirName} component of the Quantum Language compiler.${ctx}

This directory contains these documented functions/files:
${files.join("\n")}

Cover: what this component does, how the files relate to each other, the overall flow.
Start with # ${dirName}, clean markdown, no excessive emojis.`;
}

// ── Extract functions from C++ source ─────────────────────────────────────────
function extractFunctions(code) {
  const functions = [];

  // Match top-level function definitions: ReturnType ClassName::funcName(...)
  const pattern = /(?:^|\n)((?:[\w:*&<>\s]+)\s+\w+::(\w+)\s*\([^)]*\)\s*(?:const\s*)?\{)/gm;
  let match;
  while ((match = pattern.exec(code)) !== null) {
    const funcName = match[2];
    const startIdx = match.index;
    // Find the matching closing brace
    let depth = 0, i = code.indexOf("{", startIdx);
    const bodyStart = i;
    while (i < code.length) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") { depth--; if (depth === 0) break; }
      i++;
    }
    const funcCode = code.slice(bodyStart, i + 1);
    if (funcCode.length > 20 && funcCode.length < 8000) {
      functions.push({ name: funcName, code: funcCode });
    }
  }

  return functions;
}

// ── Map cpp file to its breakdown directory ────────────────────────────────────
function getCppBreakdownDir(filePath) {
  const fileName = filePath.split("/").pop();
  const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();

  // Special case mappings
  const MAP = {
    "interpreter": {
      dir: "src/interpreter",
      subfolders: {
        "eval": "Evaluate",
        "exec": "Execute",
        "callFunction": "Built-in Method Dispatch",
        "callNative":   "Built-in Method Dispatch",
        "callInstanceMethod": "Built-in Method Dispatch",
        "evalAddressOf": "C++ Pointer Operators",
        "evalArrow":     "C++ Pointer Operators",
        "evalDeref":     "C++ Pointer Operators",
        "evalNewExpr":   "C++ Pointer Operators",
        "registerNatives": "Constructor",
        "Interpreter":   "Constructor",
        "applyFormat":   "helpers",
        "toInt":         "helpers",
        "toNum":         "helpers",
      }
    },
    "lexer":       { dir: "src/lexer",       subfolders: {} },
    "parser":      { dir: "src/parser",      subfolders: {} },
    "value":       { dir: "src/value",       subfolders: {} },
    "main":        { dir: "src/main",        subfolders: {} },
    "token":       { dir: "src/token",       subfolders: {} },
    "typechecker": { dir: "src/typechecker", subfolders: {} },
  };
  return MAP[baseName] || { dir: `src/${baseName}`, subfolders: {} };
}

// ── Get subfolder for a function based on its name ───────────────────────────
function getSubfolder(funcName, subfolders) {
  for (const [prefix, folder] of Object.entries(subfolders)) {
    if (funcName.startsWith(prefix) || funcName === prefix) {
      return folder;
    }
  }
  return null;
}

// ── HF API call ───────────────────────────────────────────────────────────────
async function callHF(prompt) {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("HF_TOKEN not set");

  let response;
  try {
    response = await fetch(HF_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1200,
        temperature: 0.3,
        stream: false,
      }),
    });
  } catch (e) { throw new Error(`Network error: ${e.message}`); }

  const text = await response.text();
  if (!response.ok) throw new Error(`HF ${response.status}: ${text.slice(0, 300)}`);

  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`HF non-JSON: ${text.slice(0, 200)}`); }

  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error(`Empty HF response: ${JSON.stringify(data).slice(0, 200)}`);

  let clean = raw.trim().replace(/^```(?:markdown)?\n?/, "").replace(/\n?```$/, "").trim();
  return clean;
}

async function generateExplanation(filePath, code, existing = null) {
  const clean = await callHF(buildSummaryPrompt(filePath, code, existing));
  return clean.startsWith("#") ? clean : `# ${filePath.split("/").pop()}\n\n${clean}`;
}

async function generateFunctionDoc(filePath, funcName, funcCode, existing = null) {
  const clean = await callHF(buildFunctionPrompt(filePath, funcName, funcCode, existing));
  return clean.startsWith("#") ? clean : `# ${funcName}\n\n${clean}`;
}

async function generateReadme(dirName, files, existing = null) {
  const clean = await callHF(buildReadmePrompt(dirName, files, existing));
  return clean.startsWith("#") ? clean : `# ${dirName}\n\n${clean}`;
}

module.exports = {
  generateExplanation,
  generateFunctionDoc,
  generateReadme,
  extractFunctions,
  getCppBreakdownDir,
  getSubfolder,
};