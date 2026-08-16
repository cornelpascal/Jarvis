export const REFERENCE_DECK_MODES = [
  "SOURCES",
  "IMAGES",
  "VIDEO",
  "WEB",
  "CODE_DIFF",
  "DOCUMENT",
  "EMPTY",
] as const;
export type ReferenceDeckMode = (typeof REFERENCE_DECK_MODES)[number];
