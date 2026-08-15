# Evidence: BUG-1 - `video/fonts/manifest.json` returns 404

While the editor loads, the app requests a font manifest that does not exist, so
every editor session records a failed network request.

## Network tab

The `manifest.json` request returns **404 Not Found**.

![DevTools Network tab, filtered to manifest, showing the manifest.json request with a 404 status](network-404.png)

## Console

The same failure surfaces as a red error in the console on load.

![DevTools Console showing GET .../video/fonts/manifest.json 404 (Not Found)](console-404.png)
