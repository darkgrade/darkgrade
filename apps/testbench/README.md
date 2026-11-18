# Test Bench UI demo

This is a static browser demonstration of the Test Bench layout and camera console. Cameras, generated previews, availability checks, settings and takes are simulated. It does not connect to hardware or upload telemetry; resetting or refreshing clears session data.

From the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run testbench
```

Open `http://localhost:5230`. Choose cameras, run simulated checks, change exposure settings and record a simulated take. Demo setup includes offline, busy and low-battery scenarios.

```sh
bun run --cwd apps/testbench build
bun run --cwd apps/testbench test
bun run --cwd apps/testbench test:e2e
```

The generated `dist` folder can be served by a static host, including under a subdirectory. Retain the CSP metadata and serve equivalent response headers from `vite.config.ts` where supported.

## Migration boundary

Only reviewed layout styles and two pure browser console components were copied from the Test Bench source snapshot identified in `MIGRATION.json`. Fonts use system fallbacks; previews are generated CSS. No backend, device/configuration data, credentials, addresses, personal records, vendor documents, media captures, installation scripts or source commit history were imported.

The pre-migration allowlist was checked before copying. `bun run security:check` scans tracked/new material for credential patterns, private endpoints and non-UI artifacts, and rejects camera/network capabilities in the demo's browser sources. Names and source content also require review: regex checks are not a substitute for reviewing new migration material.

Test Bench UI migrations and follow-up PRs may be squash-merged to keep history clean. Bring later UI updates across as reviewed source snapshots; do not merge the hardware repository's history.
