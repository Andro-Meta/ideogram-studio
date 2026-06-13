/**
 * Copy text to the clipboard, working over plain HTTP on the LAN too.
 *
 * `navigator.clipboard` is only available in a secure context (HTTPS or
 * http://localhost). Opened from a phone via the LAN IP or `generate.athome`
 * (plain http://), it's undefined and throws. Fall back to the legacy
 * `document.execCommand("copy")` via a hidden textarea. Returns whether the
 * copy succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the execCommand path
  }

  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.top = "0"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
