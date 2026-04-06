/**
 * Code Intelligence module barrel export
 */
export { TreeSitterService } from "./TreeSitterService.js";
export type { LanguageName, TagCapture } from "./TreeSitterService.js";

export { RepoMapBuilder } from "./RepoMapBuilder.js";
export type {
  Symbol,
  SymbolKind,
  RankedSymbol,
  RepoMap,
  FileSummary,
} from "./RepoMapBuilder.js";

export { SymbolIndex } from "./SymbolIndex.js";
export type {
  SymbolLocation,
  SymbolSearchOptions,
  SymbolReference,
} from "./SymbolIndex.js";
