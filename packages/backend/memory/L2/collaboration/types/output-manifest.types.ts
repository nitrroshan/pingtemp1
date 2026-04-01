/**
 * Output Manifest Types — Re-exports from shared types/
 *
 * The canonical definition now lives in memory/types/output-manifest.types.ts
 * since OutputManifest bridges L1 (produces) and L2 (discovers).
 * This file re-exports for backward compat within L2.
 */
export type {
  OutputManifest,
  OutputEntry,
} from "../../../types/output-manifest.types.js";
