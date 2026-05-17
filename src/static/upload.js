/**
 * Alpine component for the upload form.
 * Registered via alpine:init — no build step, ES2017+ hand-authored.
 *
 * D-08: XHR POST to /api/upload with X-API-Key header and onprogress bar.
 * D-11: apiKey is injected from server-rendered HTML (see src/views/upload.ts).
 */

function uploadForm(apiKey) {
  return {
    // State
    file: null,
    label: "",
    progress: 0,
    state: "idle", // idle | uploading | success | error
    errorMessage: "",
    result: null,
    copied: false,
    isDragOver: false,
    noFileError: false,

    // Select file from picker or drop
    selectFile(f) {
      this.file = f || null;
      this.errorMessage = "";
      this.noFileError = false;
    },

    // Drag-over handler
    dragOver(e) {
      e.preventDefault();
      this.isDragOver = true;
    },

    // Drag-leave handler
    dragLeave(e) {
      e.preventDefault();
      this.isDragOver = false;
    },

    // Drop handler
    drop(e) {
      e.preventDefault();
      this.isDragOver = false;
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) this.selectFile(f);
    },

    // Submit the form via XHR (D-08)
    submit() {
      if (!this.file) {
        this.noFileError = true;
        return;
      }

      this.state = "uploading";
      this.errorMessage = "";
      this.progress = 0;

      const formData = new FormData();
      formData.append("file", this.file, this.file.name);
      if (this.label.trim()) {
        formData.append("label", this.label.trim());
      }

      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          this.progress = Math.round((e.loaded / e.total) * 100);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            this.result = JSON.parse(xhr.responseText);
            this.state = "success";
          } catch {
            this.errorMessage = "Unbekannter Fehler. Bitte Seite neu laden.";
            this.state = "error";
          }
          return;
        }

        // Map error codes to German copy per UI-SPEC §"Error States"
        if (xhr.status === 401) {
          this.errorMessage = "Archivierung fehlgeschlagen. Bitte Seite neu laden.";
        } else if (xhr.status === 413) {
          this.errorMessage = "Datei zu groß. Maximale Größe: 100 MB.";
        } else if (xhr.status === 502) {
          this.errorMessage = "Zeitstempel-Dienst nicht erreichbar. Bitte in einigen Minuten erneut versuchen.";
        } else {
          this.errorMessage = "Unbekannter Fehler. Bitte Seite neu laden.";
        }

        this.state = "error";
      };

      xhr.onerror = () => {
        this.errorMessage = "Unbekannter Fehler. Bitte Seite neu laden.";
        this.state = "error";
      };

      xhr.open("POST", "/api/upload");
      xhr.setRequestHeader("X-API-Key", apiKey);
      xhr.send(formData);
    },

    // Copy archive ID to clipboard
    copyId() {
      if (!this.result || !this.result.id) return;
      navigator.clipboard.writeText(this.result.id).then(() => {
        this.copied = true;
        setTimeout(() => { this.copied = false; }, 2000);
      });
    },
  };
}

document.addEventListener("alpine:init", () => {
  Alpine.data("uploadForm", uploadForm);
});
