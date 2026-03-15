// lib/models.js
const mongoose = require("mongoose");

const updateSchema = new mongoose.Schema({
  filePath:    { type: String, required: true },
  docPath:     { type: String, required: true },
  status:      { type: String, enum: ["success","error","skipped"], required: true },
  error:       { type: String, default: null },
  commitSha:   { type: String, default: null },
  triggeredBy: { type: String, default: "webhook" },
  timestamp:   { type: Date,   default: Date.now },
});

const docIndexSchema = new mongoose.Schema({
  filePath:      { type: String, required: true, unique: true },
  docPath:       { type: String, required: true },
  lastCommitSha: { type: String, default: null },
  updatedAt:     { type: Date,   default: Date.now },
});

module.exports = {
  Update:   mongoose.model("Update",   updateSchema),
  DocIndex: mongoose.model("DocIndex", docIndexSchema),
};
