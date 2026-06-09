/** Build a WebSocket URL for the given path.
 *  In Vite dev (port 5173) the backend runs separately on :8000;
 *  in production the SPA is served by the backend itself, so use same origin.
 */
export function buildWsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  const host =
    window.location.port === "5173"
      ? `${window.location.hostname}:8000`
      : window.location.host
  return `${proto}//${host}${path}`
}
