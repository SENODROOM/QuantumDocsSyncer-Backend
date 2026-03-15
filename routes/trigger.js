// routes/trigger.js
const router = require("express").Router();
const { getAllRepoFiles } = require("../lib/github");
const { enqueue, shouldProcess } = require("../lib/queue");

router.post("/", async (req, res) => {
  try {
    const { files, all } = req.body || {};
    let toProcess = [];

    if (all) {
      const allFiles = await getAllRepoFiles();
      toProcess = allFiles.filter(shouldProcess);
    } else if (Array.isArray(files) && files.length) {
      toProcess = files.filter(shouldProcess);
      if (toProcess.length === 0) {
        return res.status(400).json({
          error: "No valid files. Only src/ and include/ folders are processed.",
          examples: ["include/AST/AST.h", "src/lexer/Lexer.cpp"],
        });
      }
    } else {
      return res.status(400).json({
        error: "Provide { files: [...] } or { all: true }",
      });
    }

    // Respond IMMEDIATELY before touching the queue
    // Vercel will kill the function after response — queue runs in background
    res.status(200).json({
      message: "Queued successfully",
      fileCount: toProcess.length,
      note: "Processing started. A PR will be opened when complete.",
    });

    // Start queue AFTER response is sent
    // Use setImmediate to ensure response is flushed first
    setImmediate(() => {
      enqueue(toProcess, null, "manual");
    });

  } catch (e) {
    // Only send error if headers not sent yet
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
});

module.exports = router;