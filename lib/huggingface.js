// lib/huggingface.js
const MODEL = "mistralai/Mistral-7B-Instruct-v0.3";
const API_URL = `https://api-inference.huggingface.co/models/${MODEL}`;

function buildPrompt(filePath, code, existing) {
  const ext = filePath.split(".").pop();
  const ctx = existing
    ? `\nExisting explanation (update it to reflect changes):\n${existing.slice(0,600)}\n---\n`
    : "";
  return `<s>[INST] You are a technical documentation expert for C++ compiler projects.

Analyze this file from the Quantum Language compiler and write a detailed README.md explanation.

File: ${filePath}
${ctx}
\`\`\`${ext}
${code.slice(0, 3000)}
\`\`\`

Write a README.md that:
1. States the file's role in the compiler pipeline
2. Explains WHY key design decisions were made
3. Documents each major class/function with purpose and behavior
4. Notes tradeoffs or limitations honestly
5. Uses clean markdown with headers and code blocks
6. No excessive emojis — be precise and technical

Output only the markdown. Start with a # heading. [/INST]`;
}

async function generateExplanation(filePath, code, existing = null) {
  const token = process.env.HF_TOKEN;
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: buildPrompt(filePath, code, existing),
      parameters: {
        max_new_tokens: 1200,
        temperature: 0.3,
        top_p: 0.9,
        do_sample: true,
        return_full_text: false,
      },
      options: { wait_for_model: true, use_cache: false },
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HF ${res.status}: ${txt.slice(0,200)}`);
  }

  const data = await res.json();
  const raw = Array.isArray(data) ? data[0]?.generated_text : data.generated_text;
  if (!raw) throw new Error("Empty HF response");

  let clean = raw.replace(/\[INST\].*?\[\/INST\]/gs, "").trim();
  clean = clean.replace(/^```markdown\n?/, "").replace(/\n?```$/, "").trim();
  if (!clean.startsWith("#")) clean = `# ${filePath.split("/").pop()}\n\n${clean}`;
  return clean;
}

module.exports = { generateExplanation };
