# Camera API check

How to confirm Slate's public API works on real cameras, quickly.

```bash
bun run --cwd packages/slate camera:api-check              # every attached Sony, Canon and Nikon
bun run --cwd packages/slate camera:api-check -- --only canon
```

`scripts/camera-api-check.ts` calls every public `Camera` method once, through the library only,
on each attached camera, with all cameras in parallel:

- connect, getInfo, getCapabilities, events on and off
- every typed setting: read it, write a different advertised choice, then put the original back
  with `setControl`
- focus, zoom, live view (with and without overlay)
- photo to the card, `listMedia`, preview, download
- record and stop, recording state
- battery, clock, `recover`, reconnect, disconnect

Each step is `pass`, `unsupported` (the camera says so, and `getCapabilities` agrees), `read-only`
(not writable right now, or only one choice), or `fail`. A step `getCapabilities` advertised as
supported that then answers unsupported is a `fail`. The summary prints only what didn't pass. The
full results go to `/tmp/camera-api-check.json`.

## Rules

- **Test only the public API, through the library.** One surface; MCP and the CLI are generated
  from the same methods.
- **Run once.** A full run takes about 1–2 minutes per camera, cameras in parallel. Longer means
  something is wrong; look before re-running.
- **Fix, then re-run only the affected camera** with `--only <brand>`.
- **Don't run other test suites** while doing this.
- **Never format, delete or overwrite** card contents. The check adds one photo and one short clip
  per camera and restores every setting it changes.
- **Studio must be closed.** The script keeps the macOS camera daemons stopped while it runs.
- **Mode matters.** Results reflect the camera's current mode and lens. Write down the mode (photo or
  movie, and any mode lever) next to a result. A Canon EOS R6 Mark III with its lever at Movie
  can't take stills over USB.
