/**
 * Artifact-suppression / quality-constraint presets.
 *
 * Ideogram 4's caption schema has NO negative-prompt field (the model has no
 * text negative — see docs/AUDIT_2026-06-14.md T11). The community-proven way to
 * get a "negative-prompt-like" effect is to state the desired quality as a
 * POSITIVE constraint, naming the artifact you want gone ("sharp focus, no
 * motion blur"). The model treats these as directives, not as a separate
 * unconditional input. Ported (re-implemented locally) from the ComfyUI node
 * hardhant/ComfyUI-AliAn-Ideogram-Magic-Prompt's "Suppress Artifacts" idea.
 *
 * This module is pure (no store/React imports) so it can be reused by the
 * settings store, the caption builder, and unit tests.
 */

import snippetData from "./constraintSnippets.json"

export interface ConstraintCategory {
  id: string
  label: string
  hint: string
  /** Positive-constraint phrase injected into the caption. */
  snippet: string
}

// The model-facing snippet text + the default selection are the SINGLE SOURCE
// OF TRUTH in constraintSnippets.json (also read by backend/constraints.py, so
// the web UI and the headless CLI can't drift). Only the UI label/hint live
// here.
const SNIPPETS: Record<string, string> = snippetData.categories

const CATEGORY_META: { id: string; label: string; hint: string }[] = [
  { id: "sharpness",   label: "Sharpness",    hint: "Crisp detail, no motion blur" },
  { id: "noise",       label: "Clean",        hint: "No grain / sensor noise" },
  { id: "compression", label: "No artifacts", hint: "No JPEG / compression blocking" },
  { id: "color",       label: "Color",        hint: "Accurate color, no fringing/banding" },
  { id: "anatomy",     label: "Anatomy",      hint: "Well-formed hands & proportions" },
]

export const CONSTRAINT_CATEGORIES: ConstraintCategory[] = CATEGORY_META.map((m) => ({
  ...m,
  snippet: SNIPPETS[m.id] ?? "",
}))

/** Categories enabled by default when the user first turns suppression on. */
export const DEFAULT_CONSTRAINT_IDS: string[] = snippetData.defaults

/**
 * Build the comma-separated constraint clause from a set of category ids plus an
 * optional free-text addition. Returns "" when nothing is selected.
 */
export function buildConstraintClause(ids: string[], custom = ""): string {
  const idSet = new Set(ids)
  const parts = CONSTRAINT_CATEGORIES.filter((c) => idSet.has(c.id)).map((c) => c.snippet)
  const extra = custom.trim()
  if (extra) parts.push(extra)
  return parts.join(", ")
}
