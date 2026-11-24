# Test Bench

Connect your own USB cameras to a basic local bench. The browser console uses Slate's generic `Camera` interface through a localhost host. No Shelly controller, managed USB hub, capture adapter or second Wi-Fi access point is required.

From the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run testbench
```

Open `http://localhost:5230`, click **Scan USB cameras**, then connect a camera. Put the camera in its USB remote-control mode and close other applications that own it. Linux users need permission to access the USB device; use the normal Slate USB setup for your system.

The console shows camera-advertised exposure choices, requests live-view frames, captures and downloads photos, and starts/stops recording where Slate supports it. Controls depend on the camera and its mode. A recording stop acknowledgement does not independently verify the saved movie; check the camera card. Failed recording starts remain uncertain until a stop succeeds, and recovery does not power-cycle or reset the USB port.

Click **Disconnect** when finished. Stopping the host normally also stops recordings it owns and closes its camera sessions. Keep the host running while recording.

Choose **Simulation** in Setup, or open `http://localhost:5230/?mode=demo`, to explore the layout without hardware. This mode labels its generated previews, settings and takes as simulated.

```sh
bun run --cwd apps/testbench build
bun run --cwd apps/testbench test
bun run --cwd apps/testbench test:e2e
```

Browser tests exercise the HTTP host with an explicitly labelled camera fixture, plus the optional simulator. They do not replace physical camera qualification. The generated `dist` folder can serve the simulator on a static host; real USB operation requires the local Bun host.

## Local access

The host binds to localhost. API calls require an exact local Host, same-origin requests and an ephemeral session token. Camera serial numbers stay out of the browser and media transfers remain local. Slate honours your existing diagnostics opt-in; manage sharing with the [shared contribution settings](../../packages/slate/docs/contribute.md). Do not expose or proxy this service to a network; it is intended for one trusted local operator.

## Migration boundary

Only reviewed layout styles and two pure browser console components were copied from the Test Bench source snapshot identified in `MIGRATION.json`. Fonts use system fallbacks. No fleet backend, device/configuration data, credentials, addresses, personal records, vendor documents, media captures, installation scripts or source commit history were imported. The basic USB host was written here against Slate.

The pre-migration allowlist was checked before copying. `bun run security:check` scans tracked/new material for credential patterns, private endpoints and excluded artifacts. Browser sources cannot import native camera transports; the reviewed local API client is the sole fetch entry point. Names and source content also require review: regex checks are not a substitute for reviewing new migration material.

Test Bench UI migrations and follow-up PRs may be squash-merged to keep history clean. Bring later UI updates across as reviewed source snapshots; do not merge the hardware repository's history.
