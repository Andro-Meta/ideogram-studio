/**
 * A UUID generator that also works over plain HTTP on the LAN.
 *
 * `crypto.randomUUID()` is only defined in a *secure context* — HTTPS or
 * http://localhost. When the studio is opened from a phone via the LAN IP or
 * `generate.athome` (plain http://, non-localhost), `crypto.randomUUID` is
 * undefined and calling it throws. That broke generation, element creation,
 * prompt-reuse, and image→prompt on mobile. This helper falls back to
 * `crypto.getRandomValues` (available in insecure contexts), then to Math.random.
 */
export function uid(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined

  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID()
    } catch {
      // fall through to the getRandomValues path
    }
  }

  if (c && typeof c.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40 // version 4
    b[8] = (b[8] & 0x3f) | 0x80 // variant 10
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"))
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`
  }

  // Last-resort fallback (no Web Crypto at all) — not cryptographically strong,
  // but these IDs only need to be locally unique.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
