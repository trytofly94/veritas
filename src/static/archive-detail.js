/**
 * Alpine.js components for the archive detail page (Phase 3 — BROWSE-02).
 *
 * Exposes two global factories so Alpine x-data attributes can reference them:
 *   - window.verifyIntegrity(archiveId): POST /api/archive/:id/verify, render
 *     state ∈ { idle | checking | ok | fail | error }.
 *   - window.copyState(): copyValue(value, ev) — write to clipboard, flip the
 *     clicked button's textContent to "Kopiert!" for 2000ms.
 *
 * No bundler. Vendored Alpine (src/static/alpine.min.js) initializes globally
 * and picks up window.* factories via Alpine.data registration below.
 */

window.verifyIntegrity = function (archiveId) {
  return {
    state: "idle",
    async run() {
      this.state = "checking";
      try {
        const res = await fetch("/api/archive/" + archiveId + "/verify", {
          method: "POST",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          this.state = "error";
          return;
        }
        const data = await res.json();
        this.state = data && data.ok === true ? "ok" : "fail";
      } catch (_err) {
        this.state = "error";
      }
    },
  };
};

window.copyState = function () {
  return {
    copyValue(value, ev) {
      if (!value) return;
      const btn = ev && ev.target;
      navigator.clipboard.writeText(value).then(() => {
        if (!btn) return;
        const original = btn.textContent;
        btn.textContent = "Kopiert!";
        setTimeout(() => {
          btn.textContent = original;
        }, 2000);
      });
    },
  };
};

document.addEventListener("alpine:init", () => {
  Alpine.data("verifyIntegrity", window.verifyIntegrity);
  Alpine.data("copyState", window.copyState);
});
