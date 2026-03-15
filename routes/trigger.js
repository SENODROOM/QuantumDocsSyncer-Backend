// routes/trigger.js
const router = require("express").Router();
const { getAllRepoFiles } = require("../lib/github");
const { enqueue, shouldProcess } = require("../lib/queue");

router.post("/", async (req, res) => {
  const { files, all } = req.body || {};
  let toProcess = [];

  if (all) {
    const allFiles = await getAllRepoFiles(); // already scoped to src/ + include/
    toProcess = allFiles.filter(shouldProcess);
  } else if (Array.isArray(files) && files.length) {
    toProcess = files.filter(shouldProcess);
    if (toProcess.length === 0) {
      return res.status(400).json({
        error: "No valid files. Only src/ and include/ folders are processed.",
        examples: ["include/AST/AST.h", "src/lexer/Lexer.cpp", "src/main/main.cpp"],
      });
    }
  } else {
    return res.status(400).json({ error: "Provide { files: [...] } or { all: true }" });
  }

  const queued = enqueue(toProcess, null, "manual");
  res.json({ message: "Queued", fileCount: queued, note: "A PR will be opened in QuantumLangCodeExplaination when processing completes." });
});

module.exports = router;
