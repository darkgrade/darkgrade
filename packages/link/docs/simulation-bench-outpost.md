# Simulation Bench integration boundary

The follow-up to PR #19 keeps camera knowledge and simulated PTP behavior in `@darkgrade/link`. A future Outpost application can present the same model catalog and capability results beside Fleet Bench without becoming another hardware controller.

## Existing Outpost pattern

The [Fleet Bench integration at 25239d7](https://github.com/darkgrade/outpost/commit/25239d7a96d98faee563a7a428f1386beeaccc54) packages `private/apps/fleet-bench` with a plugin manifest, stdio MCP `server.ts`, `page.html`, source modules and an `upstream.json` revision pin. The server constructs the app explicitly; its page and the model use the same tools. Its setup keeps monitoring paused while the existing controller is active. Bench ownership reaches the app's monitor, readiness and UI paths.

Simulation Bench should use that host pattern when its application is built. This change does not install or deploy an Outpost application.

## Reusable surfaces now

- `identifyCamera({ vendorId, productId, ptpModel? })`, exported from `@darkgrade/link`, is a pure lookup. `USBTransport.discover()` includes this identification for each enumerated USB device. No request opens a camera or starts monitoring. The generated table is checked in CI with `cameras:check` and refreshed by `cameras:build` after catalog/profile changes.
- `loadCameraProfile` and `SimulatedTransport` are package exports. Construct a separate transport for each simulated session, with a fresh profile. State must not leak between parallel app users or tasks.
- Capability evaluation and matrix generation remain development tooling in `scripts/camera-profiles`; the existing compatibility UI in `scripts/compat-ui` presents the results without an Outpost deployment. The JSON matrix is the reviewable result artifact; an app should import a reusable runner extracted from this tooling when needed, rather than executing hardware scripts or parsing Markdown.
- SDK findings live in `camera-catalog/sdk-evidence.json` with the interpretation and limits in `camera-sdk-evidence.md`. Source binaries, captures, camera serials and private SDK material are excluded from application assets.

## Evidence the application must preserve

A USB match is identification evidence, not control validation. `054c:096f`, for example, is cited for an A7 III control personality and for the bench alpha6700 before USB mode selection. The lookup returns both candidates. Known exact PTP model aliases can narrow them; a conflicting model readback is `identity-mismatch`. Unknown IDs remain unknown. A charging-only `054c:0d68` is not recognized as a working alpha6700.

Each lookup candidate lists cited model names and its profile's firmware and coverage: raw/parsed/partial/absent DeviceInfo, advertised operation counts, descriptors, exchanges and modeled quirks. Counts describe available evidence; they are not a reliability score. An empty captured profile may identify a historically observed body while providing no runnable command responses. SDK analysis and documented simulations remain unverified on hardware until a physical test produces evidence for the capability and firmware in question.

The compatibility matrix retains `resultEvidence` per capability (fidelity, profile, firmware where known, host, timestamp and revision). A physical session test cannot promote a captured recording result to a hardware pass. Known conflicting firmware versions remain separate, and shared USB IDs alone do not merge models; exact catalog/profile aliases are required. Matrix cells label a weaker evidence source when one supplies a result absent from a stronger row.

Workflow qualification is separate from individual capability results. The gaps API/UI retain the [Test Bench recording and collection dependency](test-bench-workflows.md) on separate PR #18. The fresh darkgrade01 workflow baseline used deployed code, not this candidate; an application must not promote it to candidate qualification or advertise complete take/collection coverage from a green software run.

## Future host responsibilities

Keep app state, run IDs, cancellation, progress and artifact retention in a host-owned data directory, with explicit start/close lifecycle methods as in Fleet's `src/embedded.ts`. Default to simulation; show the exact profile and evidence tier before a run. Display missing data and unsupported commands distinctly from failures. SDK support lists do not prove Darkgrade supports those models.

Physical validation belongs to the bench's guarded capability adapter: fresh status, mapped camera identity, recording/ownership guards, leased jobs, heartbeats, per-camera locks and cleanup. Fleet and Outpost should request that work through the bench, retain its run/evidence IDs and display the result. They must not import bench recovery internals, reset shared USB banks or launch a competing recovery monitor. No simulation run should implicitly activate a physical camera.
