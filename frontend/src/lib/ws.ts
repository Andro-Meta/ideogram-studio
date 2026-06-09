/** Build a WebSocket URL for the given path, handling dev (port 8000) vs production. */
export function buildWsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  const host =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? `${window.location.hostname}:8000`
      : window.location.host
  return `${proto}//${host}${path}`
}
