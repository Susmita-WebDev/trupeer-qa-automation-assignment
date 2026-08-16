# Evidence: developer-level console & network capture

![Trupeer editor console and network capture: a 404 on the font manifest.json, an ensureToken "missing action dispatcher" warning with a stack trace into Trupeer's own chunks, and a Userflow font-load timeout warning](dev-console-capture.png)

Captured live from a real editor session with Playwright (the same session the
Part 2 suite uses), then filtered to **Trupeer-origin entries only** - browser
extension traffic and third-party analytics were removed, so nothing here is
mis-attributed to Trupeer. The same entries are visible in DevTools (Console and
Network tabs).

What it shows:

- **404 on `.../video/fonts/manifest.json`** - corroborates **BUG-4** (the font/asset pipeline misconfiguration) at the network layer.
- **`ensureToken: attempt 0 failed  Error: Invariant: missing action dispatcher.`** with a stack trace into `app.trupeer.ai/_next/static/chunks/635-*.js` - corroborates **DEV-1** (the Next.js Server-Actions race on editor load).
- **`Userflow.js: Timed out waiting for font family Inter to load`** - a minor warning from the third-party onboarding script. On this run Userflow loaded; the separate **DEV-2** uncaught exception (`Could not load Userflow.js`) only occurs when that script is *blocked* (ad-blocker / privacy extension), which is why it is documented as conditional rather than shown here.

The capture is reproducible on demand and is deliberately kept honest: it records
what an editor load actually produces, not a staged failure.
