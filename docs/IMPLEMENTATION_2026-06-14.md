# Ideogram 4.0 Studio — Implementation Log (2026-06-14)

Companion to `AUDIT_2026-06-14.md`. This records what was implemented from the audit roadmap, how each change was verified, and what was deliberately deferred (with the reasoning and a concrete plan to finish it).

All work was done on the real files in `E:\IdeoGram_4`. Verification was run in an isolated sandbox copy reconstructed from the git-committed base **plus the exact edits** (anchor-checked), because the sandbox's file mount intermittently corrupts the tails of just-edited files — see "Verification note" at the end. The real `E:\` files were confirmed intact via direct reads.

---

## Phase 1 — Generation control surface (DONE, verified) ⭐

The single highest-value item in the audit. Replaced the one opaque `soft_guidance` boolean with a real, parameterized **CFG curve** — the lever the Banodoco/ComfyUI community uses for both quality and to avoid the model's out-of-distribution "safety collapse."

**Backend (`inference.py`, `schemas.py`, `main.py`)**
- Generalised `_soft_guidance_schedule(...)` → `_build_guidance_schedule(num_steps, *, forward, cfg, cfg_override, override_start)` and added `_resolve_guidance_schedule(...)`, which builds a high→low per-step schedule from user values or falls back to the preset's frozen schedule. Correct list direction is preserved for each pipeline (diffusers = forward, ideogram4-package = reverse).
- `GenerationSettings` and `GenerationRequest` gained `cfg`, `cfg_override`, `cfg_override_start` (replacing `soft_guidance`). A shared `CfgControlsMixin` (validated/clamped) is reused by `GenerationRequest`, `InpaintRequest`, and `ExtendRequest`, so the **same CFG controls now apply to text-to-image, remix/inpaint, and extend** (fixes audit conflict C2 — the edit paths previously ignored guidance settings).
- Both pipeline `generate()` methods and `BF16Pipeline.inpaint()` now call the resolver.

**Frontend (`types/api.ts`, `settingsStore.ts`, `CfgControl.tsx`, `Generate.tsx`, `useRemixFromImage.ts`)**
- New `CfgControl` component: master toggle + sliders for CFG, override (tail) CFG, and the drop point ("last N%").
- `settingsStore` ships the **community-recommended defaults ON**: CFG 3.5 dropping to 2.0 for the last 30% of steps (audit P0 "lower default CFG"). A v3 migration replaces the old `softGuidance` flag. Users can switch it off to use the raw preset (CFG 7) or tune the values.
- CFG fields flow through both the generate and remix requests.

**Verification:** `inference/schemas/main/magic_prompt` compile; unit tests on the schedule builder confirm correct length, high/low split, both list directions, and the preset-passthrough/defaults logic; frontend `tsc -b` exits 0.

**Also fixed on this path:**
- **B1** — Settings *Save* button now enables on **any** change (incl. toggle-only changes like moderation / auto-structure / free-models), via an `isDirty` flag. Previously those changes were unsaveable.
- **B2** — "Generate from image" (remix) now shows the **real seed and duration**: `/api/edit/inpaint` and `/api/edit/extend` return `seed` + `duration_ms` (added to `EditResponse`), and the UI uses them instead of fabricating `0`/`0.0s` (which also fixes the `ideogram-0.png` filename).

---

## Phase 2 — Collapse prevention & recovery (DONE, verified)

- **B3** — `useGenerate` WebSocket `onclose` now reads **live** store status and treats any abnormal close that isn't `done`/`error` as a failure — covering the model-load phase, which previously swallowed drops and left the UI spinning.
- **Empty-canvas guard** — added `boxCoverageFraction()` + a warning in `validatePromptState`: when boxed elements leave most of the canvas uncovered, the user is told to add a near-full-canvas background element (the community "fill the empty space" fix for the fake-alpha / collapse failure mode). Coverage logic unit-tested.
- *(The strong short-prompt collapse guard — the #1 documented cause — already existed in `validatePromptState`; left as-is.)*

**Verification:** frontend `tsc -b` exits 0; coverage logic verified on full / 20%-box / two-halves cases.

---

## Phase 3 — Stability fixes & cleanup (DONE, verified)

- **B5** — On `WebSocketDisconnect`, the generation job is now **reaped** (`fail_job` "Cancelled — client disconnected") instead of being orphaned as `running` forever.
- **LoRA guard consistency** — `/api/loras/weight` and `/api/loras/remove` now check `supports_lora` up front (409 with a clear message), matching `/api/loras/apply`.
- **Dead-code removal** — deleted the unused `EditRequest` type (frontend; referenced nothing, didn't match the editor's real adjustments) and the never-called `MagicPromptService.rebuild()` (backend).

**Verification:** backend `py_compile` clean; frontend `tsc -b` exits 0 with `EditRequest` removed (0 dangling references).

### Phase 3 items intentionally NOT coded (documented instead)
- **B4 (resolution alignment) — verified to be a NON-bug for this model.** The pipeline requires multiples of `vae_scale_factor(8) × patch_size(2) = 16`, which exactly matches the schema's existing `%16` validator. Forcing `%32` would have *broken* valid presets (e.g. 720×1280, 2016×864). No change needed.
- **Advanced steps / mu / std panel (P2).** Not built — lower value once the CFG controls landed, and a *steps* override interacts with the CFG `guidance_schedule` length (they must match), which adds regression risk that can't be runtime-tested without a GPU. Recommended approach below. (mu/std are safe to expose alone but low value without steps.)

---

## Phase 4 — Experimental / perf

### DONE (verified) ✅

- **Auto seed-retry on collapse** — the research's most-endorsed anti-collapse fix ("changing the seed flips it"). Implemented end to end:
  - `inference.is_safety_collapse(image)` — a conservative detector for the gray "safety card" (requires near-grayscale **and** near-flat **and** near-edge-free). Fail-open. **Unit-tested:** flags a flat-gray frame, does not flag colour-noise or a gradient.
  - Wired into the WS `_run` loop behind an **off-by-default** `auto_retry_on_collapse` setting (`settings.py` + `SettingsResponse`/`SettingsUpdateRequest` + GET/PUT handlers), with a `Settings` toggle. On a detected collapse it re-rolls the seed and regenerates up to `auto_retry_max_attempts` (default 3) — **only when the seed isn't user-locked** — emitting a "retrying…" status. Off by default precisely because the detector can't be tuned without real captured cards; the toggle's help text says to leave it off if you intentionally make flat/gray images. Thresholds are documented for tuning on the GPU box.
- **C1 (model-variant sync)** — `useLoadModel` now persists the loaded variant to the server (`PUT /api/settings`, fire-and-forget) so the server's `.env` default never goes stale against the client store. The client stays the authority; no surprising UI change. Typechecks clean.

### Deferred (genuinely hardware-gated / experimental)

- **Custom sigma schedule ("ExtendIntermediateSigmas").** The diffusers `Ideogram4Pipeline` computes sigmas internally (`_logit_normal_sigmas`) and `__call__` does **not** accept a custom sigma list, so this needs a pipeline subclass/patch. The community itself is split on it ("makes outputs bad"; Kijai: it's ≈ a seed change), so it's low ROI and quality-risky — and the now-shipping auto seed-retry achieves the same intent more safely. Left as a genuine experiment for the GPU box.
- **Flash-attention.** A real win for this model (head dim 256; ~1.15–1.73× on attention; SageAttention does nothing here). This is an **install/runtime** concern (torch build + attention processor), not an app code change, and can't be benchmarked in this CPU sandbox. *Recommendation:* document an optional FA2 install in `install.bat`/README and verify on the 24 GB GPU. (Leave `torch.compile` off — the community reports it currently degrades Ideogram 4 quality.)

---

## Recommended next steps (when on the GPU box)

1. Run `run.bat`, generate with the new CFG controls (default 3.5 → 2.0 @ last 30%) vs. the old preset (toggle off → CFG 7) and confirm the quality/refusal improvement on photos.
2. Turn on **Auto-retry on collapse** in Settings, deliberately trigger a gray card, and tune the detector thresholds in `inference.is_safety_collapse` (`sat_thresh` / `var_thresh` / `edge_thresh`) against the real captured cards if needed.
3. Optionally add the **advanced panel** (custom steps + mu/std/shift). Note: a *steps* override must rebuild the CFG `guidance_schedule` to the same length — handle that in `_resolve_guidance_schedule`/the request path to avoid a length-mismatch error.
4. If desired, evaluate the two remaining experiments on-GPU: optional FA2 flash-attention (perf) and the custom sigma schedule (quality — likely redundant now that auto seed-retry ships).

---

## Verification note (sandbox file mount)

During this session the Linux verification sandbox's view of the repo intermittently returned **corrupted tails** (null-padding or truncation) for files immediately after they were edited, while the real `E:\` files were correct. To verify safely, each edited file was reconstructed in `/tmp` from its **git-committed base + the exact edits** (every edit anchor was confirmed to match exactly once) and compiled/typechecked there; the authoritative `E:\` files were additionally confirmed clean by direct reads. No verification relied on the corrupted mount copies, and nothing reconstructed was written back to `E:\`. If the dev server ever shows a syntax error that these checks didn't, re-pull/refresh the working tree — the `E:\` source is the source of truth and was confirmed intact.
