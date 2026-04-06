/**
 * IndexSnapshot Mongoose Model — L2 persistence for code intelligence indexes
 *
 * Stores gzipped MiniSearch index + symbol entries + file states per branch.
 * Used by IndexPersistence for snapshot save/load/fork/merge.
 *
 * @see feature_implementation_planning.md Phase 6
 */

import mongoose, { Schema, type Model } from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface SymbolEntry {
  file: string;
  name: string;
  kind: string;
  line: number;
  endLine: number;
  signature: string;
  language: string;
}

export interface FileState {
  file: string;
  contentHash: string; // sha256
  lineCount: number;
  language: string;
}

export interface IIndexSnapshot {
  branchId: string; // workspace branch — CoW key
  searchIndex: Buffer; // MiniSearch.toJSON() → gzipped
  symbols: SymbolEntry[]; // all symbols across all files
  fileStates: FileState[]; // content hash per file
  version: number; // schema version
  savedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

const indexSnapshotSchema = new Schema<IIndexSnapshot>(
  {
    branchId: { type: String, required: true, unique: true, index: true },
    searchIndex: { type: Buffer, required: true },
    symbols: [
      {
        file: String,
        name: String,
        kind: String,
        line: Number,
        endLine: Number,
        signature: String,
        language: String,
      },
    ],
    fileStates: [
      {
        file: String,
        contentHash: String,
        lineCount: Number,
        language: String,
      },
    ],
    version: { type: Number, default: 1 },
    savedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const IndexSnapshotModel: Model<IIndexSnapshot> =
  (mongoose.models.IndexSnapshot as Model<IIndexSnapshot>) ||
  mongoose.model<IIndexSnapshot>("IndexSnapshot", indexSnapshotSchema);
