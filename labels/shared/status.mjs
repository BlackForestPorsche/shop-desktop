/** Shared Labels service status helpers (vendored). */
export function buildStatus(extra = {}) {
  return {
    ok: true,
    service: "labels",
    ...extra,
  };
}
