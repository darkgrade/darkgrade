# Studio end-to-end walk

Launches the built Studio with Playwright's Electron support, waits for the camera and walks the
feature list: battery and card readouts and the camera display switch, every setting row (changed,
read back from the camera, restored), click-to-focus then Focus, take photo, record then stop, the
card browser's thumbnail, preview and download, and the overlay switches. Each step checks the UI and
the value the camera reports through Studio's main process (`window.studio`), fails on camera errors
in Studio's log, and saves a screenshot to `e2e/results/<VID-PID>/`.

It takes a photo and a short clip on the card and leaves them there; it never deletes or formats.
A file it downloads to this Mac is removed again unless it was already there.

```sh
bun run --cwd apps/studio build          # the walk runs out/main/index.js
bun run --cwd apps/studio e2e            # once per attached camera, each inside the camera lease
DARKGRADE_CAMERA=054c:0e78 bun run --cwd apps/studio e2e   # one body
DARKGRADE_E2E_VISION=1 bun run --cwd apps/studio e2e       # also flip Depth Pro and SAM 3 (may download models)
bun run --cwd apps/studio e2e:dry-run    # no Studio, no camera: a fake that must fail at "wait for the camera"
bun run --cwd apps/studio typecheck:e2e
```

Quit Studio first: the lease refuses to start while it runs. Each camera needs PC Remote mode, a card
with room for one photo and a clip, and Studio's own handling of `DARKGRADE_CAMERA` to pick the body.
