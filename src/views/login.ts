/**
 * Login page view module.
 * Renders the login form HTML per UI-SPEC component inventory.
 * No JavaScript required — login flow works with pure HTML form POST + server redirect (D-04).
 */

export function renderLoginPage({ error }: { error: boolean }): string {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Veritas</title>
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <main class="page page--login">
    <div class="card">
      <h1>Veritas</h1>

      <form method="POST" action="/login">
        <div class="field">
          <label for="password-input" class="field__label">Passwort</label>
          <input
            type="password"
            id="password-input"
            name="password"
            class="input"
            autocomplete="current-password"
            required
            aria-describedby="${error ? "login-error" : ""}"
          >
        </div>

        <button type="submit" class="btn btn--primary">Anmelden</button>

        ${error ? '<p class="error" id="login-error" role="alert">Falsches Passwort.</p>' : ""}
      </form>
    </div>
  </main>
</body>
</html>`;
}
