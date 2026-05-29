/**
 * Upload page view module.
 * Renders the full upload form HTML per UI-SPEC component inventory.
 *
 * D-11 trade-off: apiKey is injected into the page as a JS literal so the
 * Alpine XHR component can POST to /api/upload directly. This is acceptable
 * because /` sits behind Cloudflare Tunnel + Caddy on a family-shared
 * deployment. If this assumption changes, swap to requireSessionPage gate +
 * /api/me/upload-token (see CONTEXT.md D-11 fallback note).
 */

export function renderUploadPage({ apiKey }: { apiKey: string }): string {
  // JSON.stringify produces a double-quoted JS string literal. The surrounding
  // HTML attribute must therefore use single quotes so Alpine sees a valid call
  // `uploadForm("key")` rather than `uploadForm(` followed by a stray quote.
  // We additionally HTML-escape any single quote that could appear in the key
  // to keep the attribute boundary intact (D-11).
  const escapedKey = JSON.stringify(apiKey).replace(/'/g, "&#39;");

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Veritas</title>
  <link rel="stylesheet" href="/static/style.css?v=2">
  <!-- upload.js must load before alpine so window.uploadForm exists when Alpine evaluates x-data -->
  <script defer src="/static/upload.js"></script>
  <script defer src="/static/alpine.min.js"></script>
</head>
<body>
  <nav class="nav">
    <a class="nav__brand" href="/">Veritas</a>
    <div class="nav__links">
      <a class="nav__link nav__link--active" href="/">Hochladen</a>
      <a class="nav__link" href="/archive">Archiv</a>
    </div>
  </nav>
  <main class="page" x-data='uploadForm(${escapedKey})'>

    <!-- Error banner — shown above the form on XHR errors -->
    <div class="error-banner" x-show="errorMessage" x-text="errorMessage" role="alert" aria-live="assertive"></div>

    <!-- Upload card — visible in idle + error states -->
    <div class="card" x-show="state !== 'success'">
      <h1>Datei archivieren</h1>

      <!-- Drag-drop zone -->
      <div
        class="drop-zone"
        role="button"
        tabindex="0"
        aria-label="Datei hierher ziehen oder Datei auswählen"
        aria-describedby="drop-hint"
        :class="{ 'drop-zone--over': isDragOver }"
        @dragover.prevent="dragOver($event)"
        @dragleave.prevent="dragLeave($event)"
        @drop.prevent="drop($event)"
        @keydown.enter.prevent="$refs.file.click()"
        @keydown.space.prevent="$refs.file.click()"
        @click="$refs.file.click()"
      >
        <span id="drop-hint" x-text="file ? file.name : 'Datei hierher ziehen oder Datei auswählen'"></span>
        <input
          type="file"
          x-ref="file"
          class="visually-hidden"
          @change="selectFile($event.target.files[0])"
          aria-hidden="true"
          tabindex="-1"
        >
        <button type="button" class="btn btn--secondary" @click.stop="$refs.file.click()">Datei auswählen</button>
      </div>

      <!-- Inline error for no-file -->
      <p class="error" role="alert" x-show="noFileError" id="file-error">Bitte zuerst eine Datei auswählen.</p>

      <!-- Label input -->
      <div class="field">
        <label for="label-input" class="field__label">Bezeichnung (optional)</label>
        <input
          type="text"
          id="label-input"
          class="input"
          x-model="label"
          placeholder="z. B. Mietvertrag, Bewerbung, …"
          maxlength="200"
          autocomplete="off"
        >
      </div>

      <!-- Progress bar — visible while uploading -->
      <div class="progress" x-show="state === 'uploading'" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="progress">
        <div class="bar" :style="'width:' + progress + '%'"></div>
      </div>
      <p class="uploading-label" x-show="state === 'uploading'">Wird archiviert …</p>

      <!-- Submit button — hidden while uploading -->
      <button
        type="button"
        class="btn btn--primary"
        x-show="state !== 'uploading'"
        :disabled="state === 'uploading'"
        @click="submit()"
      >Jetzt archivieren</button>
    </div>

    <!-- Confirmation panel — shown after successful upload -->
    <div class="card confirm" x-show="state === 'success'" x-cloak>
      <h1>Archivierung erfolgreich</h1>

      <div class="confirm-row">
        <span class="confirm-label">Archiv-ID</span>
        <span class="confirm-value">
          <code class="ulid" x-text="result && result.id"></code>
          <button type="button" class="btn btn--small" @click="copyId()">
            <span x-text="copied ? 'Kopiert!' : 'Kopieren'"></span>
          </button>
        </span>
      </div>

      <div class="confirm-row">
        <span class="confirm-label">TSA-Anbieter</span>
        <span class="confirm-value" x-text="result && result.tsa_provider"></span>
      </div>

      <div class="confirm-row">
        <span class="confirm-label">Zeitstempel</span>
        <span class="confirm-value" x-text="result && result.tsa_attested_at"></span>
      </div>

      <div class="confirm-row">
        <span class="confirm-label">Status</span>
        <span class="confirm-value status-verified">✓ Verifiziert</span>
      </div>

      <a
        class="btn btn--primary btn--download"
        :href="result ? '/api/download/' + result.id : '#'"
        x-show="result"
      >Archiv-Bundle herunterladen</a>

      <p class="hint">Zur Offline-Verifikation: verify.sh aus dem Bundle ausführen.</p>
    </div>

  </main>
</body>
</html>`;
}
