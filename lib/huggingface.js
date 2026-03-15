// lib/huggingface.js
// Correct endpoint for HuggingFace router (api-inference.huggingface.co is dead - 410)
// Use OpenAI-compatible chat completions format

const MODEL   = "mistralai/Mistral-7B-Instruct-v0.3";
// Correct URL: router.huggingface.co/v1/chat/completions
// Model is passed in the body, NOT in the URL
const HF_URL  = "https://router.huggingface.co/v1/chat/completions";

function buildPrompt(filePath, code, existing) {
  const ext = filePath.split(".").pop();
  const ctx = existing
    ? `\n\nExisting explanation (update only what changed):\n${existing.slice(0, 500)}\n\n---\n`
    : "";

  return `You are a technical documentation expert specialising in C++ compiler design.

Analyse this source file from the Quantum Language compiler and write a detailed README.md.

File: ${filePath}${ctx}
\`\`\`${ext}
${code.slice(0, 2800)}
\`\`\`

Write a README.md that:
1. Explains what this file does and its role in the compiler pipeline
2. Explains WHY key design decisions were made (not just what)
3. Documents each major class/function with purpose and behaviour
4. Notes tradeoffs or limitations honestly
5. Uses clean markdown headers and code blocks — no excessive emojis

Output ONLY the markdown. Start with a # heading.`;
}

async function generateExplanation(filePath, code, existing = null) {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("HF_TOKEN not set in environment");

  let response;
  try {
    response = await fetch(HF_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model: MODEL,                           // model in BODY, not URL
        messages: [
          { role: "user", content: buildPrompt(filePath, code, existing) }
        ],
        max_tokens: 1200,
        temperature: 0.3,
        stream: false,
      }),
    });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HF ${response.status}: ${text.slice(0, 300)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`HF non-JSON response: ${text.slice(0, 200)}`);
  }

  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error(`Empty HF response: ${JSON.stringify(data).slice(0, 200)}`);

  let clean = raw.trim()
    .replace(/^```(?:markdown)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();

  if (!clean.startsWith("#")) {
    clean = `# ${filePath.split("/").pop()}\n\n${clean}`;
  }

  return clean;
}

module.exports = { generateExplanation };
