# Untangle preview

The reviewers reported 525 problems. About 480 are left once duplicates seen from two areas are merged. That count includes 27 comment findings and 35 test findings. Nine design fixes cover roughly 80% of them:
- a driver interface with vendor hooks, so shared code stops switching on `instanceof`;
- wire facts carried on property definitions, with codecs that return typed values;
- one vendor table;
- one operation descriptor list generated from `Camera`;
- one media/recording lifecycle;
- one observed body-mode state with scoped enter/restore;
- one transport-neutral session and property catalog, which Sony's native PTP and Camera Remote SDK connections both implement;
- Studio as a `CameraRuntime` host that passes `CameraControlState` through;
- one typed IPC/registry table in Studio.

The rough effect is 6-9k lines of executable code removed and about 1.5k added (interfaces, tables, the confirm primitive). Generated Sony data is reshaped into one catalog and reported separately; it is not counted as simplification. About 21 special cases stay. They are bench findings, documented SDK defects, cited vendor quirks, AGENTS-required polling, and the recorded Sony ISO/gain-mode exception, and some of them move into their driver.

Nothing has changed yet. This file is the plan. Its status on main after #126, and the revised order, are in [Revisions after #126 (2026-11-26)](#revisions-after-126-2026-11-26).

## Revisions after #126 (2026-11-26)

This plan was written at ebcab86 on the #126 branch, after the brands moved to `src/vendors/<brand>`. About 35 commits landed after it before the squash merge (7438458). Most paths still exist; line numbers drifted, most in `sony-camera.ts`, `nikon-camera.ts`, `canon-camera.ts`, `generic-camera.ts` and `camera-controls.ts`. Almost nothing in the plan is done. Statuses were checked by grep on main, not item by item.

### Naming

One name per concept across brands (Cyril, 2026-11-26): a concept every vendor has gets one generic name, in code and docs, with the vendor's behaviour behind it. There is no `SonySession`, `CanonX` or `NikonY` for something that exists on every brand: the session is a session (`CameraSession`), whichever vendor or transport implements it. Vendor folders (`src/vendors/<brand>/`) and wire names stay as they are; this is about the concepts and type names in the docs and APIs.

### Status per fix

- **1. Driver interface: still needed, and larger.** One item is done: `availability` now uses its capabilities argument (`generic-camera.ts:1499-1508`). The `instanceof` switches remain in `vendors/camera-controls.ts` (233-602), `vendors/photo-video-mode.ts:91-93`, `vendors/generic/capture-driver-image.ts:32-43`, `vendors/profile-qualification.ts:16-19`, `workflows/telemetry-benchmark.ts:122-179`, `vendors/drivers.ts:74` and `generic-camera.ts:1424` (`SonyRemoteSdkTransport`). The TRANSITIONAL `owner` is at `generic-camera.ts:1371-1376`, the TRANSITIONAL block at `generic-operations.ts:13`. `CameraDriverInstance`, `DriverCore`, `settingActions`, `setSonySetting`/`setSonyProperty`, `NikonShotControls` and `storageHost` all remain. The per-setting string setters sit at `generic-camera.ts:1128-1150` and `canon-camera.ts:436-484`, plus Nikon's and Sony's `setIso`.
- **2. Typed definitions: still needed.** Canon now has named responses (`canon-response-definitions.ts`, used for ObjectNotReady), but literal codes remain in Canon and Nikon. `use4ByteCode`, `canonicalExposureInput`, `canonicalControlInput`, `videoCodecValueNames` and `sdiControlCode` remain. `sdiControlCode` is now also read in `vendors/protocol-evidence.ts`. The collector item moved to `src/telemetry/server/transport.ts`.
- **3. One vendor table: still needed; the USB scope item is partly done.** The USB default is now class-only (`usb-transport.ts:156-159`), so every vendor's PTP body is found; `cli/benchmark.ts:85` and `scripts/camera-api-check.ts:14` keep their own lists. Raw vendor ids in `protocol-evidence.ts` went from 9 to 15. Studio's `VENDOR_NAMES` and `vendorIdForMake` remain (`apps/studio/src/main/camera-service/shared.ts:85-97`). `protocol-evidence.ts` grew by about 120 lines of request evidence and needs the table too.
- **4. Operation descriptors: partly done.** The list is committed (`src/runtime/camera-operations.ts`) and `check:guards` checks it. `generate-camera-operations.ts --compatibility` still writes a re-export at the old `build/generated` path for older readers; delete it once Matrix and Test Bench read `src/runtime`. Studio's `writtenSetting` still strips "set" (`studio-tools.ts:459-460`). The other items were not changed.
- **5. One media lifecycle: still needed, and larger.** Sony's `takePhoto` now watches the card index (`watchCardIndex` in `sony-camera.ts:1681-1727`, parsed by `vendors/sony/content-info-list.ts`). That is a fourth way to find a new file, beside Canon's ObjectAddedEx, Nikon's ObjectAdded and the generic pollers. `captureProfilePhoto` and `UsbVideoRecording` remain; the Studio RAW walker is at `shared.ts:216-257`.
- **6. Body mode: partly started.** `vendors/generic/focus-point-changes.ts` (`FocusPointChanges`, used by Canon, Nikon and Sony) records what `setFocusPoint` changed and undoes it on `resetFocusPoint` and disconnect, only while the body still shows Slate's value. It is the first shared restore record; `withMode` should grow from it rather than beside it. The Sony flags and Studio's `withLiveViewPaused` remain.
- **7. Session and catalog: still needed.** No shared session contract; `sdk-camera.ts` (845 lines) and `sdk-controls.ts` keep their own tables.
- **8. Per-session state: still needed.** `randomSessionId` remains in `ptp/definitions/session.ts`, used by `generic-camera.ts` and `sony-camera.ts`.
- **9. Container codec and transport contract: still needed.** No `linkKind`. Call attribution was added in `core/telemetry.ts` (the observer takes a `callId`), not as another transport decorator, so the three decorators are still three.
- **10. Typed errors: still needed in Slate; partly done in Studio.** Studio's `zoom.ts` and `live-view.ts:160` now catch `CameraUnsupportedError`, but the `/not supported/i` fallback and `withTimeout` remain.
- **11. Injected services: still needed, and larger.** `core/telemetry.ts` is now 491 lines and also holds the call instrumentation (`instrumentCameraOperations`). `FocusPointChanges` keeps a module-global map by body. `createContributions` remains; `installationIdOf` does not exist; `isContributionId` exists in `contribute/schema.ts` but the other UUID regexes were not checked. Eight `./contribute/*` package exports are compatibility aliases of `./telemetry/*` with no caller in this repository.
- **12. CLI table: still needed.** The CLI files are unchanged since the plan apart from four lines in `camera-operation.ts`.
- **13. Studio as a runtime host: still needed.** Studio keeps its own queue (`camera-service.ts:141-178`, used at `studio-tools.ts:491`), so `cameraArgument` in `runtime/mcp.ts` stays. `mcp-server.ts` has no function named `protect`; its hand-written catch (31-49) still flattens errors to text. Undo is still global; the 1500 ms hotplug wait is `HOTPLUG_CONNECT_DELAY_MS` in `shared.ts:37`.
- **14. Control passthrough: partly done.** Studio writes through `camera.setControl` and uses Slate's control list (2acf3f9). Still there: `matchOption` snapping within a third of a stop (`shared/setting-values.ts:39-65`) and `VALUE_SYNONYMS`; the setIso/setShutterSpeed/setAperture channels (`ipc.ts:436-438`, preload 34-36, `ipc-handlers.ts:117-119`); the `settings` block; the white-balance switch with a 5600 K guess (`studio-tools.ts:157-168`); the lossy `CameraControl` type; `nearestIndex`; the dead `controlProperties` map.
- **15, 16, 17. Studio IPC table, model engine, renderer primitives: still needed.** Unchanged.
- **18. Small fixes: still needed.** `runCameraBenchmark` is still exported (`src/index.ts:1`), so are `movie-audio` (index.ts:76) and the `export *` of PTP types (95-107). The Firestore-shaped interface is now `src/telemetry/server/database.ts`. The Studio items remain.

Nothing in the plan is obsolete. The special cases still stand.

### New consolidation #126 created

- **`captureDriverImage` beside `takePhoto`.** `vendors/generic/capture-driver-image.ts` keeps an `instanceof` chain for the capture modes `takePhoto` lacks (host memory, RAW compression, release without transfer). `profile-media.ts`, `tests/bench-ptpip.ts` and Matrix's harness call it. Make those modes driver capture options under fix 1 and fix 5, or keep it on `/protocol` only.
- **String setters beside `setControl`.** `Camera`'s typed setters are generated over `setControl`, which is right, but each driver still has its own `setIso(string)`-style methods with their own admission. Delete them under fix 1.
- **The main entry still carries a second API.** `src/index.ts` exports `VideoTake`, `optimiseShot`, `analyseShot`, `normalizeCameraPower`/`readCameraPower` (which take a vendor string) and raw PTP types. Under the public/private bar these are workflows on top of `Camera` or protocol access.
- **`/protocol` keeps three recording classes and vendor helpers.** `UsbVideoRecording`, `SonyVideoRecording`, `SonyPtpVideoRecording`, `NikonShotControls` and the card-index parser are exported there. Fix 5 and fix 7 should leave one recording capability, and Test Bench and Matrix should be checked before each export goes.
- **Studio imports `/protocol`** for `VendorIDs`, Sony content types, `parseSonyFocalFrameInfo` and `TransportType` (`camera-service/shared.ts`, `settings.ts`, `usb-experiments.ts`). A host should need none of them.
- **Four "find the new file" paths**, one per brand (above, fix 5). One card-index hook on the driver, with Sony's content list as its Sony implementation.
- **Vendor request decoding in shared code.** `requestEvidence(vendorId, …)` in `vendors/protocol-evidence.ts`, called from generic telemetry, decodes Canon 0x9110, Sony 0xd2dc and Nikon 0xd102 itself; FixedMovie 0xd1c2 is now a constant in a fourth place and Sony 0xd2dc in a second. Each driver should supply its decoder, as `explainResponse` already does.
- **More shared Nikon and exposure logic** in `camera-controls.ts`: a Z5 II FNumber filter (199-205), `canonicalShutterChoices` and a second exposure comparator, `sameExposure`, with a fifth float tolerance.
- **Compatibility shims with a removal date:** the `build/generated` re-export and the `./contribute/*` aliases.
- **The Matrix field allowlist** in `src/telemetry/server/review.ts` (`matrixProtocolFields`, `matrixKinds`) restates Matrix's importer schema from the other repository. Keep one list and test the export against Matrix's importer.

### Revised order of work

1. Deploy the collector from main and run the end-to-end telemetry test (below). It does not depend on any refactor, and every bench run until then loses its call entries.
2. Remove what breaks the repository's own rules in Studio: `matchOption` snapping, the 5600 K white-balance guess and the manual-value guess (fix 14). They are small and change behaviour, so they go first.
3. Delete dead surface and shims (fix 18 deletions, `runCameraBenchmark`, `movie-audio`, `createContributions`, the `build/generated` re-export, the `./contribute/*` aliases), after tracing Test Bench and Matrix.
4. Inert defaults and injected services (fix 11), including the telemetry module state and the focus-point store.
5. The container codec and transport contract (fix 9), then the vendor table and per-session state (fixes 3 and 8).
6. Typed definitions (fix 2), then the driver interface (fix 1) one vendor at a time, folding in the driver string setters and `captureDriverImage`.
7. The body-mode primitive (fix 6), grown from `FocusPointChanges`, then the media lifecycle (fix 5) with one card-index hook.
8. The property catalog and the session contract, with Sony's two connections behind it (fix 7).
9. Typed errors (fix 10), the rest of the operation descriptors (fix 4) and the CLI table (fix 12).
10. Studio: the runtime host (fix 13), the rest of fix 14, then fixes 15, 16 and 17.
11. Comments with each fix; tests last, as before. Re-checks are unchanged: the Slate suite, `test:package`, `camera:api-check` on every bench camera, and the telemetry test again after fixes 1, 5 and 9, which move the code that emits call and protocol entries.

### Progress on `slate/final-blockers` (PR #129)

- Order step 2 done (0abd344): Studio's `matchOption` no longer snaps within a third of a stop, and the 5600 K, white-balance switch and auto-to-manual guesses are gone. `VALUE_SYNONYMS`, the setter channels and the rest of fix 14 remain.
- Order step 3 done (56e9b01, 6258c1f, d7d112b): `createContributions`/`fileConsentStore`, the `./contribute/*` and `./telemetry/node` exports, `runCameraBenchmark`, the vendor re-exports in `camera/index.ts`, `movie-audio` and the `build/generated` re-export; the PTP `export *` moved from the main entry to `/protocol`. Test Bench was changed first (darkgrade/test-bench#61, 58a2f7e: its own movie track check, either operation list). Benches must run Test Bench 58a2f7e or later before hardware validation of this branch.
- Order step 4, fix 11, partly done (d4d6240, 2599b3e, 19261c6, 1d458b2, 2cd6d4f): `sdkTelemetry` in `vendors/sony`; the call surface is an argument; the Logger is inert by default; Canon/USB stop writing to the console; core's Logger no longer imports the registry; one owner for the installation key format and the confirmation window; one VID:PID[:SERIAL] reader and writer (fc54c53); bench:profile's revision from `slateBuildMetadata` (b8c4f93). Still to do: the telemetry module state and core's automatic Node settings (that one decides whether a Node host collects by default, so it is a product decision, not a refactor), the NODE_ENV checks, the focus-point store, `first-contact`'s dynamic import, the atomic writes and locks, `X-Bench-Action` (needs Test Bench), the privacy wording (needs the policy owner).
- Fix 3 partly done (69e7ac8, 0a844fd): one vendor table, each brand's `vendor.ts` supplying make, registry, driver kind, manufacturer and lens-mount rule; the CLI and camera:api-check read it (`isSupportedVendor` deleted). Still to do: the driver class choice (with fix 1), the raw ids in the evidence and profile decoders, Studio's `VENDOR_NAMES`.
- Fix 2 started (97c0ab5): the channel, PTP/IP, Canon and Nikon name their response and operation codes from the definitions instead of literals.
- Fix 1 started, one hook at a time: `storageCanRecord()` (a08752a: generic storage no longer imports Nikon or Sony), `readPower()` behind `getBattery` (9650773: no vendor-id string, no owner; the driver-free readings are `vendors/power-reading.ts`), one Nikon vendor-code decoder for the driver, the benchmark and profile capture (400d62c), card readings that take a typed driver so `storageHost` is gone and PTP media no longer needs the owner (b66bb66), the photo/video switch asking its own driver for the recorder (6b67e44). `owner` is still read by `writeCameraControl` (for `NikonShotControls`), `cardSteps`' serialize (the controls queue) and Sony's `openSonyRecordingMode`: those go with `controls()` and fix 5. `readCameraPower`/`normalizeCameraPower` stay public until Test Bench's video-take script stops calling them.
- Fix 9 partly done (dcda055, 435cfe5): one container codec and one parameter-block rule in `ptp/container.ts`; `transport/usb/usb-container.ts` is gone and PTP/IP no longer imports the USB transport for framing. A transport names its own connection (`connectionKind()`, bd63d02), which also removed the one allowlisted SDK import.
- Fix 8 started: session ids are never 0 and come from one `createSessionId()` (637e3c0); the channel owns the DeviceBusy retry and its policy, which only `configure()` writes (4a17197). Canon's own five-attempt property-write resend stays in the Canon driver: folding it into the channel's retry changes what a refused write reports, which needs a decision on the bench.
- Vendor SDK rule (#130): the SDK backend has no USB connect (1d20c0c); Test Bench's credential read that used the SDK over USB is retired (darkgrade/test-bench#62). It needs Sony PTP 0xD079 (MonitoringOutputDisplayHDMI) defined natively, with bench evidence, to come back.
- `runtime/operations.ts` reaches the browser runtime, so anything it imports must stay free of `contribute/settings` (the browser bundling test caught a first attempt that imported `core/telemetry`).

#### Constraints found while doing this

- Matrix's fixed harness imports candidate modules by path: `@camera/index`, `@camera/protocol-session`, `@transport/interfaces/{transport.interface,transport-types,device.interface}`, `@transport/ip/ip-transport`, `@vendors/profile-capture`, `@vendors/profile-qualification`, `@vendors/generic/capture-driver-image`, `@vendors/canon/recording-mode`, `@vendors/sony/ptp-video-recording` and some PTP datasets. Moving or folding one of these (fix 9's transport-type folding, fix 5's recording classes, `captureDriverImage`) needs a Matrix harness change, or a path fallback, in the same batch.
- Test Bench's hardware CI lease (`ci/matrix/bench-lease.ts`) pins the SHA-256 of Slate's `runtime/ownership.ts` and `runtime/errors.ts`. Fix 11's ownership literals and a change to `HardwareBusyError` must repin it in Test Bench first.
- Test Bench's hardware CI loads the candidate's `/protocol` for `protocolSession`, `TransportFactory`, `TransportType`, `prepareNikonManualExposure`, `readNikonRecordingStatus`, `readNikonWirelessStatus` and `driver.captureImage`, and its main entry for `Camera` and `observeCameraEvents`. Those stay until its harness changes.

## Other final blocker: end-to-end telemetry testing

#126 changed what Slate records and what the collector accepts. Each public `Camera` call is one `call` entry with a `callId`, and every PTP, evidence and SDK entry made during it carries that `callId` (`instrumentCameraOperations` in `src/core/telemetry.ts`, linked by `src/core/call-context.ts`). Every `data` and `response` entry carries `commandCode`. A property write carries `prior` and `priorAgeMilliseconds` when the session had read the property (`requestEvidence` in `src/vendors/protocol-evidence.ts`). A session that starts on an open connection begins with an `attach` entry.

The collector code for all of this is on main in `src/telemetry/server`. The schema accepts `call`, `attach`, `callId` and `commandCode` (`src/contribute/schema.ts`, `src/contribute/protocol.ts` for `prior`). `postgres.ts` derives the `call:<operation>:<outcome>` signal and the named busy signals. `operator-queries.ts` returns `command_code` and the call columns on issues. `review.ts` (`diagnosticPattern`) leaves call and attach entries, `prior` and the new evidence types out of the Matrix export. `tests/telemetry/postgres.test.ts` covers these against a real Postgres.

What has not happened is the deployed path. The deployed collector is older than this code:

- The only run of `.github/workflows/telemetry-deploy.yml` (on 86e6e9c, 2026-11-25) failed at "Check deployment configuration": the `telemetry` environment's variables are not set. No collector image from #126 has been deployed through it.
- Read through Outpost's Telemetry on 2026-11-26: the benches uploaded about 650,000 events in the last day, all from revisions that record calls (7466e4a to 473ff64), but no `call:` signal exists in the last 7 days, issues carry no `command_code`, and Canon 0xA102 is listed as plain `response:0xa102` rather than the named busy signal. That is what an older collector does: it rejects batches with the new fields, and the client (`legacyBatch` in `src/contribute/application.ts`) sends them again without calls, `attach`, `commandCode`, the new evidence types or `prior`. Those entries are dropped, not kept for later.

An end-to-end test must prove, on a deployed collector built from main:

1. A Slate client on a bench camera (USB first, then PTP/IP) makes a few public calls through each surface (library, MCP, CLI) with one call that succeeds, one the camera refuses and one that is unsupported. The batch it uploads holds the `call` entries and the protocol entries linked to them by `callId`, `commandCode` on responses, and `prior` on a property write.
2. The collector accepts that batch on the first try (no legacy resend) and stores the entries as sent.
3. Outpost's Telemetry app (0.12/0.13) shows the refused call in Issues as `<operation> · <outcome>` with its error class and response, groups it by `command_code`, and its Replay shows the call with its protocol work indented under it and the Request row's `prior` value.
4. Matrix's sync (`sync_matrix`) completes for that session and receives the protocol patterns it did before, and none of the new kinds or fields: no `call` or `attach` entries, no `commandCode`, no `prior`, none of the new evidence types.
5. An older client's batch is still accepted unchanged.

Not verified yet:

- The deployed collector's revision. `/healthz` reports only `ok`, so the deploy should also report its revision.
- The deployment itself: the workflow's environment variables, then a deploy of main, then its smoke check.
- Any of steps 1-5 with real data. The collector tests use fixtures; Outpost's Telemetry pages were built against fixtures and the branch collector; Matrix sync has run only on data without the new fields.
- That the Sony SDK path and Studio (the `studio` surface) emit call entries the same way.
- What happens to the call entries the benches recorded since 2026-11-25: the legacy resend dropped them, so they are not in Telemetry and will not be.


## Fixes

- **1. A `CameraDriver` interface owns every vendor difference. Shared code runs one algorithm: admit, send once, confirm by polling.**
  `camera/driver.ts` becomes a pure interface with no concrete-class imports. Each brand implements its hooks:
  - `controls()`, which gives observe and write per inventory (Nikon photo and movie are two inventories);
  - `storageCanRecord()`;
  - `captureOptions` and still-mode preparation;
  - `battery()`;
  - `advertisedInventory()`;
  - `fullObjectSize()`;
  - `connectionKind`;
  - `targetedRefresh()`.

  `vendors/camera-controls.ts` keeps only `confirmedWrite(observe, send)`. Dependencies afterwards run façade → interface ← generic ← brands. No driver holds `owner`.
  - packages/slate/src/vendors/camera-controls.ts:225 — the observe/write switch on `instanceof` Sony/Canon/Nikon. Moves into each driver's `controls()`. (Also reported from Canon/Nikon at camera-controls.ts:128-200, 247-271 and 450-549.)
  - packages/slate/src/vendors/camera-controls.ts:128-200 — about 150 lines of Nikon-only mode/Auto-ISO/guard/range logic. Moves to vendors/nikon.
  - packages/slate/src/vendors/sony/sdk-camera.ts:188-213 — the SDK `setControl` re-implements admission and readback. Use `confirmedWrite` with an SDK observe/send pair.
  - packages/slate/src/vendors/camera-controls.ts:555-570 — three copies of confirm-with-readback with timeouts of 2000, 5000 and 5000 ms (also photo-video-mode.ts:129-139 and sdk-camera.ts:205-212). One primitive, one timeout policy, always checks the source code is unchanged.
  - packages/slate/src/vendors/sony/sdk-camera.ts:189-215 — the three SDK write paths `setControl`, `setSonySetting` and `setSonyProperty`. Merge into one.
  - packages/slate/src/vendors/sony/sdk-controls.ts:82-95 — the `settingActions` parallel setter list. Delete it; callers use setControl.
  - packages/slate/src/vendors/photo-video-mode.ts:76-93 — the mode reader and vendor switch are split from the drivers' `enterMovieMode`/`selectPhotoVideoMode`. Becomes the driver's `photoVideoMode` control.
  - packages/slate/src/vendors/nikon/shot-controls.ts:11 — a second Nikon movie stack with raw codes, labels, guards and encode checks. Delete it once the Nikon `controls()` absorbs it. The duplicates collapse with it:
    - camera-controls.ts:181-189 and shot-controls.ts:121-126, the movie ISO rule;
    - camera-controls.ts:459-465, shot-controls.ts:127, nikon-camera.ts:214-221 and camera-controls.ts:150-156, the four shutter-angle guards;
    - camera-controls.ts:517-524, shot-controls.ts:131-143 and nikon-camera.ts:222-231, the three write paths;
    - shot-controls.ts:100-105 against camera-controls.ts:499-505, range expansion;
    - shot-controls.ts:33-34, the `as unknown as` probe.
  - packages/slate/src/vendors/camera-controls.ts:466-468 — the control id → 'set-iso' → 'iso' round-trip (also shot-controls.ts:15). Removed.
  - packages/slate/src/workflows/shot-setup.ts:15-60 — the `optimiseShot` action vocabulary. Rewrite against `getCapabilities`/`setControl`.
  - packages/slate/src/workflows/camera-qualification.ts:31 and shot-setup.ts:12 — hosts repeat the writability admission. Trust setControl's confirmed observation.
  - packages/slate/src/vendors/profile-qualification.ts:33-39 — every property goes through the 'iso' slot (reported in two areas). The verifier takes an observe/set/compare pair.
  - packages/slate/src/vendors/generic/storage.ts:3 — generic storage imports Nikon/Sony and branches on vendorId (reported in three areas, 20-23). Use the `storageCanRecord()` hook.
  - packages/slate/src/vendors/generic/capture-driver-image.ts:5-8 — an `instanceof` chain for capture options and `withSonyPhotoMode` (reported in three areas). Use driver-declared options plus `withStillMode`.
  - packages/slate/src/vendors/sony/photo-mode.ts:76-88 — the `SonyPhotoModeDriver` adapter exists only for a free function. Becomes a driver method, as on Canon.
  - packages/slate/src/vendors/generic/generic-camera.ts:52 and 1364-1368 — imports `SonyRemoteSdkTransport` for 'wifi' (reported twice). Use `transport.linkKind` (see fix 9).
  - packages/slate/src/vendors/generic/generic-camera.ts:1421-1426 — getBattery maps vendorId to a 'sony'/'canon'/'standard' string (also camera-power.ts:69-79 duck-typing). Use the `battery()` hook.
  - packages/slate/src/vendors/camera-power.ts:18 — `normalizeCameraPower`/`readCameraPower` take a vendor string and are exported from the main entry (index.ts:118). Make them internal behind getBattery.
  - packages/slate/src/vendors/generic/generic-camera.ts:1313-1319 — the 'TRANSITIONAL' `owner` back-reference (reported in two areas, drivers.ts:75). Deleted. NikonShotControls and `getRecordingState` take the driver.
  - packages/slate/src/camera/camera-context.ts:8-14 — the `CameraDriverInstance` union and `DriverCore = Pick<GenericCamera>`, so two driver types exist. Replace with one interface.
  - packages/slate/src/camera/protocol-session.ts:96-107 — protocolAccess passes duck-typed `camera: any` through (also camera-power.ts:57, movie-audio.ts:35, storage.ts:8, card-storage.ts:7, ptp-video-recording.ts:19). Helpers take a typed driver.
  - packages/slate/src/vendors/generic/generic-operations.ts:82-88 — `storageHost` builds a fake session. Deleted.
  - packages/slate/src/workflows/telemetry-benchmark.ts:107-188 and profile-capture.ts:318-384 — two copies of the advertised inventory, with instanceof checks, raw opcodes and a registry rebuilt per property (telemetry-benchmark.ts:122-179). Use one `advertisedInventory()` per driver.
  - packages/slate/src/workflows/telemetry-benchmark.ts:65 — reaches into driver internals (observeProfile, prepareStorageRead, resumeShooting…), and the snapshot type carries a 'benchmark' literal (generic-camera.ts:157). Give diagnostics a narrow port.
  - packages/slate/src/vendors/camera-power.ts:7, nikon/shot-controls.ts:8, sony/video-recording.ts:2, camera/video-recording.ts:5 — drivers import types from workflows (reported in two areas). CameraPower, TakeMedia, ShotProperty and qualification move to camera/.
  - packages/slate/src/vendors/canon/canon-camera.ts:32 — Canon imports its own map through the root barrel. Import it from vendors/canon. Delete the re-export at control-properties.ts:29 along with `readCameraCapabilities` (camera-controls.ts:216-219).
  - packages/slate/src/vendors/sony/sony-camera.ts:433-453 with camera-controls.ts:551 — the ISO/gain-mode composite is split across layers. It stays a Sony exception, but lives entirely inside the Sony `controls()`.
  - packages/slate/src/vendors/sony/control-properties.ts:3-4 and camera/settings/values.ts:247-266 — Sony ZoomSetting/LiveViewImageQuality tables sit in the camera layer and are imported back (also typed-settings.ts:46 runtime vendor imports). The tables move into vendors/sony.
  - packages/slate/src/camera/settings/typed-settings.ts:157, 198 and values.ts:235, 244 — Canon movie-record regex and movie sound '0' re-encoded. Move into the vendor codec.
  - packages/slate/src/vendors/control-properties.ts:72-93 — `videoCodecValueNames` builds a registry and module cache, and its name clashes with values.ts:247. Owned by the vendor inventory (fix 3).
  - packages/slate/src/vendors/canon/canon-camera.ts:356-359 — Record goes through the property setter with readback turned off. Recording becomes a Canon command step (fix 6).
  - packages/slate/src/vendors/canon/canon-camera.ts:422-443 — dead `setFocusMode`/`setColorTemperature`/… duplicate admission. Delete after checking tests/bench-ptpip.ts. The parallel per-setting API goes the same way: GenericCamera getAperture/setAperture/getIso/setIso (generic-camera.ts:1070-1092).
  - packages/slate/src/vendors/nikon/nikon-camera.ts:250-252 — `setStandardProperty` has a photo-quality alias string list. Delete it; the controls inventory owns it.
  - packages/slate/src/vendors/nikon/control-values.ts:10-30 vs camera-controls.ts:75-79 — labels are formatted by name, then parsed back. Fix 3 removes both sides.
  - packages/slate/src/vendors/camera-controls.ts:451-456, 303-307 — mode and encoding guards keyed on property-name prefixes. Fix 3's per-definition mode replaces them.
  - packages/slate/src/vendors/canon/canon-camera.ts:1327-1347 — Canon reads its own cache through `listPropertyStates().find(name)`. Use `propertyCache.get(definition)`.
  - packages/slate/src/vendors/canon/canon-camera.ts:1263-1277 and nikon-camera.ts:1072-1082 — the recording pass-throughs are copied. Compose once in the generic driver from vendor steps.
  - packages/slate/src/vendors/canon/canon-camera.ts:1245-1261 and nikon-camera.ts:1055-1070 — takePhoto and the live-view overlay refusal are copied, as is the availability entry (1467, 1176). Compose once.
  - packages/slate/src/vendors/generic/vendor-extension-camera.ts:11-20 — a subclass that only sets two fields. Use constructor arguments.
  - packages/slate/src/vendors/generic/generic-camera.ts:1334-1336 — `openSession({observeOnly})` is used only by Sony. Becomes a Sony constructor option.
  - packages/slate/src/vendors/generic/generic-camera.ts:1437-1440 — `availability(_capabilities)` has a parameter the base ignores. The interface takes what the overrides need.
  - packages/slate/src/vendors/generic/generic-camera.ts:261-277 — telemetry is monkey-patched in as instance properties. Instrument inside recordingCapability.
  - packages/slate/src/vendors/drivers.ts:74 — Canon `keepAlive` is special-cased in the factory. Pass options generically; the special case stays as Canon reading its own option.
  - packages/slate/src/camera/driver.ts:243 — `getCapabilities(requested?)` and its Nikon branch. Becomes the separate `targetedRefresh()` (stays, moved).
  - packages/slate/src/vendors/generic/generic-operations.ts:1-112 — a grab-bag module, with TRANSITIONAL re-exports at 12-18 still used by sdk-camera.ts:19. Split it into focus input, availability and card steps, and drop the re-exports.
  - packages/slate/src/vendors/generic/media-id.ts:13-36 — `SonyContentMediaReference` lives in the generic media-id codec. Use a vendor-registered reference kind.
  - packages/slate/src/vendors/generic/generic-camera.ts:924 — the Sony SDIO_ControlDevice decoder sits in the generic telemetry. Use a vendor-provided decoder.
  - packages/slate/src/vendors/sony/sony-camera.ts:1180-1198 — the `requestedMode` parameter exists only for the exposure-program write. Exposure program raises its own confirmation error via `confirmedWrite`.

- **2. Wire facts live on the definitions, and codecs return typed values (number plus unit) instead of display labels.**
  Each property definition carries:
  - unit, scale and mode (photo/movie);
  - its datatype-chosen codec;
  - write behaviour (momentary, incremental, ranged, display-only);
  - which operation parameter names a property.

  Labels are formatted once in camera/. ptp/ becomes a leaf that camera/ reads.
  - packages/slate/src/vendors/camera-controls.ts:75-80 (9 sites) — 'ExposureTime', 'NikonMovie*' and the 10000/100 scales re-derived from names. These become definition attributes.
  - packages/slate/src/ptp/definitions/property-definitions.ts:107, 236, 176 with camera-controls.ts:76, shot-setup.ts:30, camera-qualification.ts:22, shot-analysis.ts:88 — 'ISO 100'/'f/2.8' are produced, then parsed back by regex. Also the ten ISO/f-number regexes (shot-setup.ts:11, camera-qualification.ts:18-25). Values become typed.
  - packages/slate/src/ptp/definitions/property-definitions.ts:100, 229 — the FNumber and ExposureIndex encoders strip non-digits and round, against AGENTS. Reject instead.
  - packages/slate/src/ptp/types/codec.ts:276 — BitfieldCodec decodes to prose its own encoder cannot read. Decode to flags.
  - packages/slate/src/ptp/definitions/property-definitions.ts:38 — exposure-program names, including Sony values, live in the generic table and are mapped again at sony/control-properties.ts:75 and exposure-program.ts:8. One definition per vendor.
  - packages/slate/src/vendors/sony/sony-camera.ts:366-369 — 0x500e is special-cased by code in four modules. Attach `SonyExposureProgramCodec` to the definition.
  - packages/slate/src/vendors/sony/sony-camera.ts:198-199, 360-363, 1118-1126 — momentary/ranged/incremental behaviour lives in regexes and lists, with ZoomPosition duplicated (105-107). Becomes definition write behaviour.
  - packages/slate/src/vendors/generic/generic-camera.ts:795, 885 — 'CanonGetEventData' by name changes logging and decoding. Add an `unlogged`/polling flag on the operation.
  - packages/slate/src/vendors/generic/generic-camera.ts:732, 891, 917-918 — substring matches on op names and `sdiControlCode`. Add `propertyParameter` metadata.
  - packages/slate/src/vendors/nikon/recording-status.ts:13 — prohibition bits decoded twice (nikon-camera.ts:704-986). Use only the codec's bit names.
  - packages/slate/src/vendors/nikon/shot-controls.ts:11 and manual-exposure.ts:16-25 — raw property codes and a hard-coded Manual [1,0]. Use the definitions.
  - packages/slate/src/vendors/nikon/control-values.ts:5 — a separate focus-mode label table. Use an enum codec on the definition.
  - packages/slate/src/vendors/nikon/nikon-camera.ts:1202-1203 and camera-controls.ts:178 — the 0x2005/0x200a 'unsupported' rule is written twice. One helper on the response definitions.
  - Literal response, event and op codes in place of registry names:
    - shot-controls.ts:85, manual-exposure.ts:14, raw-capture.ts:14, recording-status.ts:12, nikon-camera.ts:302, 828, canon-camera.ts:220, 577 (response codes);
    - canon-camera.ts:936-1116 (events 0xc189/0xc18a);
    - nikon-camera.ts:120, 365, 873 (ops 0x9207…).
  - packages/slate/src/ptp/transaction-channel.ts:45 and ip-transport.ts:463 — CLOSE_SESSION and OK as literals. Use the registry names.
  - packages/slate/src/camera/exposure-time.ts:53, values.ts:22-26, camera-controls.ts:98, 378 — four float tolerances. One exact-match helper.
  - packages/slate/src/vendors/camera-controls.ts:326-328, control-properties.ts:258, photo-video-mode.ts:57, controls.ts:88, exposure-time.ts:24 — 'Unrecognized (<raw>)' is formatted inline and stripped by regex. Carry `unrecognized` as data.
  - packages/slate/src/camera/exposure-time.ts:21, 26-29 and values.ts:44-57 — the special exposure kinds are listed four times. One table.
  - packages/slate/src/camera/settings/values.ts:130-158 — the `canonicalExposureInput` id if-chain. Move to a per-setting record with its type and reader. Delete the `canonicalControlInput` pass-through (typed-settings.ts:258-264).
  - packages/slate/src/vendors/control-properties.ts:40-49, 143-149, 192-199 — three parallel per-inventory tables, plus a fourth key derivation at camera-controls.ts:198. Use one inventory record holding properties, names and vocabulary, which also removes the sonySdk fallback (201-206).
  - packages/slate/src/ptp/datasets/device-prop-desc-dataset.ts:80 — `use4ByteCode` exists only for Nikon, chosen by opcode at profile-capture.ts:155. Use a Nikon dataset variant.
  - packages/slate/src/ptp/datasets/device-prop-desc-dataset.ts:89 and sdi-ext-device-prop-info-dataset.ts:85 — descriptor interpretation is copied. One routine.
  - packages/slate/src/ptp/datasets/device-prop-desc-dataset.ts:1, 56 with camera/controls.ts:88 — ptp↔camera imports for UnrecognizedValues/`recognizedDescriptorValues`. The application view moves to camera/.
  - packages/slate/src/vendors/canon/canon-camera.ts:62, photo-video-mode.ts:31, camera-controls.ts:265, protocol-evidence.ts:24 — FixedMovie 0xd1c2 is a constant three times and read three ways (reported in two areas). Make it a typed Canon property read by one driver reader.
  - packages/slate/src/vendors/canon/canon-camera.ts:285, 865, 1285-1286 — CanonRecordStatus is interpreted three ways. One reader.
  - packages/slate/src/telemetry/server/transport.ts:7 — Slate Sony op names 'connect_wifi'/'connect_bluetooth_direct' hard-coded in the collector. Export them from the contribute schema.

- **3. One vendor table: vendorId → name, make, registry factory, driver factory, discovery scope, lens-mount rules, event aliases.**
  Lives in vendors/ (root), and only brand folders hold vendor data. Every vendor switch reads it.
  - packages/slate/src/vendors/drivers.ts:35-72, capture-properties.ts:4-11, protocol-evidence.ts:11-15 — the vendor → registry choice is written four times (reported in three areas), each hard-coding littleEndian.
  - packages/slate/src/vendors/protocol-evidence.ts:24, 42, 116-124, profile-media.ts:22, 61, profile-qualification.ts:25, profile-capture.ts:73-88, 325-381, telemetry-benchmark.ts:122 — raw 0x04a9/0x04b0/0x054c comparisons (reported in two areas).
  - packages/slate/src/vendors/generic/generic-camera.ts:1453-1485 — MAKES, mount regexes and SDIE event names inside GenericCamera.
  - packages/slate/src/vendors/registry.ts:141-148 — one-line registry wrappers. Become table rows.
  - packages/slate/src/transport/usb/usb-transport.ts:22, vendor-ids.ts:1, drivers.ts:25, cli/benchmark.ts:125, camera-api-check.ts:14 — three discovery scopes, and Fujifilm/Panasonic/Leica/Sigma/OM are missing from the USB default.
  - packages/slate/scripts/capture-profile.ts:45 — a raw '04b0' check.
  - apps/studio/src/main/camera-service/shared.ts:85-97 — Studio's own vendor table and `vendorIdForMake`. Read Slate's identity instead.
  - apps/studio/src/main/camera-service/shared.ts:142-149 — `describeModel` reshapes the identity. Slate supplies the display name.
  - packages/slate/src/camera/validated-models.ts:20 and camera-identification.ts:31 — two model-name normalisers. Keep one.

- **4. One operation descriptor list generated from `Camera` doc tags. The façade applies the policy and every surface iterates the list.**
  The tags declare queued/immediate, read-only, destructive, setting vs action, held pair, returns file, needs connect, keeps session while recording, control id written, and help/examples. `Camera` wraps every operation in its queue policy and `withPublicErrors`. Runtime, MCP, CLI, Studio and camera-api-check read the generated list. Dependencies: surfaces → generated list → Camera.
  - packages/slate/src/camera/index.ts:391-397 — the hand-written `reportedOperations` sits beside generate-camera-operations.ts:48-56 and driver.ts:238-294.
  - packages/slate/src/camera/index.ts:166, 257, 287-298 with generic-operations.ts:110 — serialisation is decided in two layers, and the driver reaches back into the controls queue.
  - packages/slate/src/camera/index.ts:110-131, 220-328 — only four operations map public errors. The descriptor applies the mapping to all of them. It also merges the second mapping path at typed-failure.ts:6-7, control-write.ts:22-59 and index.ts:438-440 (`withCause` duplicates ErrorOptions).
  - packages/slate/src/core/operation-queue.ts:5-6 — the queue is keyed by a constant 'camera'. Split the per-Camera queue from runtime's keyed queue.
  - packages/slate/src/camera/confirmation.ts:11-12 — 'record_start' labels. Separate operation names from telemetry names.
  - packages/slate/src/runtime/operations.ts:77, 89, mcp.ts:60, 93, cli/commands.ts:145, camera-operation.ts:27, 96, cli/index.ts:268 — five per-surface name lists.
  - packages/slate/src/cli/camera-operation.ts:96 and commands.ts:145 — the dead `heldOperations` stopRecording branch, because startRecording is routed away first. Keep one held mechanism.
  - packages/slate/src/cli/recording.ts:110 and camera-operation.ts:94 — the keep-session rule is written twice.
  - packages/slate/src/cli/camera-operation.ts:117, 67 and cli/index.ts:365 — disconnect and diagnostics-close failures are swallowed, so the command exits 0. Report a nonzero exit.
  - packages/slate/src/runtime/operations.ts:87 and commands.ts:184, 204 — cliCommand is round-tripped through display text.
  - packages/slate/src/cli/commands.ts:148 — the `commandHelp` table moves into the doc comments.
  - packages/slate/src/runtime/operations.ts:160 — a colorTemperature text → number special case. Use a per-control value schema from cameraControlDefinitions.
  - packages/slate/scripts/generate-camera-operations.ts:17 — repeats the runtime types. Import them.
  - packages/slate/scripts/generate-camera-operations.ts:36 and check-guards.ts:136 — two exclusion lists.
  - Done (2026-11-25): the list is committed as src/runtime/camera-operations.ts, so `src` builds without the generator; check:guards fails when it is out of date.
  - packages/slate/scripts/camera-api-check.ts:90 — a hand list of methods. Iterate the generated list; its vendor table goes to fix 3.
  - apps/studio/src/main/tools/studio-tools.ts:458-464 — `writtenSetting` strips 'set' from the operation name. Use the descriptor's control id.
  - packages/slate/src/index.ts:16-69 vs controls.ts:2-48 — two hand lists that have drifted. The main entry re-exports /controls.

- **5. One media lifecycle: a per-session card index (storage ids, handles, new-file discovery classified by `mediaKind`), recording that returns a confirmed Clip, and one chunked download / 64-bit size path.**
  Takes, profiles and Studio consume `Camera.takePhoto`/`startRecording`/`stopRecording`. Dependencies: workflows → Camera → driver card index.
  - packages/slate/src/camera/video-recording.ts:84-116, generic/storage.ts:58-79, profile-media.ts:27-59 — three new-file pollers with different extensions, intervals and deadlines (also video-recording.ts:7 sleep(300)). One primitive. Its poll stays (AGENTS: no replay).
  - packages/slate/src/camera/video-recording.ts:39-59, 10-16 — UsbVideoRecording duplicates Camera recording and swallows CameraClipNotFoundError (reported in two areas, recording-lifecycle.ts:147-251). Wrap the confirmed Clip.
  - packages/slate/src/camera/video-recording.ts:36-38 — fullObjectSize is used only for 'nikon'. Trust the hook.
  - packages/slate/src/vendors/profile-media.ts:10-95 — `captureProfilePhoto` is a second takePhoto with its own Sony claim/restore. Delete it.
  - packages/slate/src/vendors/generic/storage.ts:40-55 and ptp-object-index.ts:72-99 — two card walkers. Keep one.
  - packages/slate/src/vendors/generic/storage.ts:71 vs media-id.ts:83, and sony/media.ts:109-126, video-recording.ts:17-19, ptp-video-recording.ts:115 — five movie-extension rules. Use `mediaKind` only.
  - packages/slate/src/vendors/generic/generic-operations.ts:79, ptp-object-index.ts:11, ptp-media.ts:12 — 0xffffffff is defined twice. The ObjectInfo dataset owns it.
  - packages/slate/src/vendors/generic/media-id.ts:93-98 and standard-clock.ts:22-28 — two PTP DateTime parsers. Use the codec.
  - packages/slate/src/vendors/generic/generic-operations.ts:76-77 and storage.ts:58 — the clip timing constant is mislabelled and has two defaults. The clip step owns it.
  - packages/slate/src/vendors/generic/storage.ts:19, 26-29 — PascalCase fallbacks serve only a test. Delete them with the test.
  - packages/slate/src/vendors/generic/generic-camera.ts:1441 and capability-groups.ts:28 — the media op names are listed twice. Dispatch by group membership.
  - packages/slate/src/vendors/sony/sony-camera.ts:1713-1745, ptp-video-recording.ts:14-165, video-recording.ts:6-92 — Sony recording exists three times and re-confirms states. Keep one capability; the SDK and PTP takes wrap Camera.
  - packages/slate/src/vendors/sony/ptp-video-recording.ts:63-108 — 64-bit size is not exposed via `fullObjectSize`. Override the hook on SonyCamera.
  - packages/slate/src/vendors/sony/ptp-video-recording.ts:153-159 — a second chunked download. Use `downloadObjectChunks`.
  - packages/slate/src/vendors/sony/media-index.ts:32-47 — index repair has its own start/stop polling. Use SonyWifiCamera start/stopRecording; the repair itself stays.
  - packages/slate/src/vendors/sony/sdk-camera.ts:309, 592-596, video-recording.ts:11-84, media-index.ts:28-43 — raw RecordingState strings in nine places. Use getRecordingState.
  - packages/slate/src/vendors/sony/ptp-video-recording.ts:8-25 and sony-camera.ts:1719-1722 — 0xd21d magic. Use MovieRecordingState.
  - packages/slate/src/workflows/video-take.ts:122-129 — `retryable` is read through a cast. Becomes a typed TakeCamera transfer error (fix 10 owns the type).
  - packages/slate/src/camera/movie-audio.ts:1-62 — no product caller. Delete after checking external consumers.
  - apps/studio/src/main/camera-service/shared.ts:216-257 — a RAW TIFF/IFD walker in Studio. Use Slate `getMediaPreview`.
  - apps/studio/src/main/camera-service/photo.ts:34-35 vs shared.ts:18-20, 197-214 — two previewable-extension lists. Use `mediaKind`.

- **6. One observed body mode per driver, entered with `withMode(required, action)`, which enters, runs and restores.**
  Covers Sony live view, post view, content transfer, playback and OSD; Nikon REMOTE/VIDEO/live view; Canon FixedMovie. Operations declare what they need. Studio never sequences modes.
  - packages/slate/src/vendors/sony/sony-camera.ts:240-251, 967-980, 1238-1243 with telemetry-benchmark.ts:182-186 — five booleans and the `prepareStorageRead`/`resumeShooting` call order.
  - packages/slate/src/vendors/sony/sony-camera.ts:256, 601, 1372-1375, 1685-1702 — two OSD flags that disagree.
  - packages/slate/src/vendors/sony/sony-camera.ts:1536-1543 — a capabilities query writes `lastSpot`.
  - packages/slate/src/vendors/sony/sony-camera.ts:1558-1573 — FaceEyeFrameDisplay is never restored (AGENTS restore rule).
  - packages/slate/src/vendors/sony/sony-camera.ts:1660-1663, 905-907 — live-view pacing waits twice.
  - packages/slate/src/vendors/sony/sony-camera.ts:1279-1295 — content-transfer mode is resent 20 times. Send once, then poll readback.
  - packages/slate/src/vendors/sony/photo-mode.ts:90-117, sdk-camera.ts:613-621, sdk-controls.ts:261-279 — three movie → still decisions.
  - packages/slate/src/vendors/nikon/nikon-camera.ts:271-297, 416-435, 728-765 — enter/run/restore is written three times.
  - packages/slate/src/vendors/nikon/nikon-camera.ts:349, 530, 708, 723 — the per-method REMOTE/IP rule.
  - packages/slate/src/vendors/nikon/nikon-camera.ts:823-837 — ChangeApplicationMode retries with fixed sleeps. Poll readback.
  - packages/slate/src/vendors/canon/canon-camera.ts:1354-1357 — a fixed 700 ms `settleMovieMode`. Poll FixedMovie.
  - Fixed sleeps with no readiness read become readiness polls: packages/slate/src/vendors/sony/sony-camera.ts:790, 793, photo-mode.ts:105, sdk-camera.ts:554-556, 619, 632.
  - apps/studio/src/main/camera-service/live-view.ts:42-48, 245-264, media.ts:45, 138, 196-202, camera-service.ts:55-56, 134-139 — Studio's `withLiveViewPaused`/`storageSessionActive` call order. Slate enforces it.

- **7. One transport-neutral session (`CameraSession`, the contract every driver's connection implements; for Sony both native PTP and the Camera Remote SDK do) over one property catalog per vendor, which for Sony joins PTP code, SDK code, names, codec and write behaviour.**
  vendors/sony depends on its catalog. The SDK session sits behind fixes 1, 5 and 6 like the PTP driver.
  - packages/slate/src/vendors/sony/sdk-controls.ts:15-81, 155-158 — a second preference table resolved by alias search.
  - packages/slate/src/vendors/sony/sdk-camera.ts:389-415 — an SDK alias map. Use `cameraControlDefinitions`.
  - packages/slate/src/vendors/sony/sdk-camera.ts:70-94 — double names per SDK code, with order-dependent naming at 351. Also the `SONY_SDK_PROPERTY_CODES` rename at 94.
  - packages/slate/src/vendors/sony/sdk-controls.ts:16-164, sdk-preview.ts:63-81, sdk-camera.ts:613, 644 — bare SDK codes.
  - packages/slate/src/vendors/sony/sdk-controls.ts:22-75, sdk-setting-labels.ts:2, control-properties.ts:86-149 — three value-name sources.
  - packages/slate/src/vendors/sony/definitions/sony-sdk-property-names.ts:5 and sdk-property-codes.ts:2 — two generated tables joined only by name. Regenerate as one catalog; report it as generated data.
  - packages/slate/src/vendors/sony/sony-camera.ts:134-142, lens.ts:11-19, ptp-recording-card.ts:17, 55 — local SDIO, lens and card codes. Register them.
  - packages/slate/src/vendors/sony/sony-camera.ts:414, 437, 484-517 — gain mode read by label and by raw value, and getIso reads twice.
  - packages/slate/src/vendors/sony/sony-camera.ts:778-801 and sdk-camera.ts:550-561 — the S1/S2 release is written twice. Its dwell times stay but are shared.
  - packages/slate/src/vendors/sony/sony-camera.ts:709-763 and sdk-camera.ts:599-667 — capture save/restore with a different restore order.
  - packages/slate/src/vendors/sony/media.ts:15-47, recording-slots.ts:17-35, ptp-recording-card.ts:36-72 — four card-status parsers that disagree.
  - packages/slate/src/vendors/sony/sony-camera.ts:137-140, 558-563 and sdk-camera.ts:534-537, 699-704, 838-841 — AF grid packing is written twice.
  - packages/slate/src/vendors/sony/sony-camera.ts:141-144, 581-597 and sdk-camera.ts:506-514 — button press/hold is copied with different bounds.
  - packages/slate/src/vendors/sony/sony-camera.ts:599-620 and sdk-camera.ts:815-835 — OSD capture is written twice.
  - packages/slate/src/vendors/sony/sdk-camera.ts:306-332 — two session-reset lists. One session-state object.
  - packages/slate/src/camera/protocol-session.ts:59, 147-151 and sdk-camera.ts:338 — `getSonyPropertyStates` covers two code spaces. Use typed session methods.
  - packages/slate/src/vendors/sony/card-storage.ts:7, 18-27 — raw ops through `protocolAccess`. Use driver methods.
  - packages/slate/src/vendors/sony/sdk-controls.ts:131-152 — SDK states carry fabricated PTP fields.
  - packages/slate/src/vendors/sony/sdk-camera.ts:160, 295-303, 335 and sdk-controls.ts:320 — the 'Wi-Fi' name is used for USB too. Rename to a Remote SDK session, keeping a `SonyWifiCamera` alias for Test Bench.
  - packages/slate/src/vendors/sony/sdk-camera.ts:29-30 — a model union that is effectively `string`.
  - packages/slate/src/vendors/sony/sdk-camera.ts:706-711, 441-445 — an AF resend and a writable wait with no bench note. Remove unless a bench finding supports them.
  - packages/slate/src/vendors/sony/sony-camera.ts:558-1269 — `setAfAreaPosition`, `setOsdImageMode`, `captureOsdImage`, `setDateTime`, `resumeShooting` and `reopenSession` are public. Make them internal after checking Test Bench.
  - packages/slate/src/vendors/sony/sony-camera.ts:122 and media-index.ts:11 — exports nothing imports. Un-export them.

- **8. One per-session state, read once at connect or recover: DeviceInfo, advertised operations and properties, identity. The driver is chosen once, from DeviceInfo, and session open runs vendor `afterOpen` hooks.**
  - packages/slate/src/vendors/canon/canon-camera.ts:224-251 — Canon copies session open and loses port-reset and `existingRecordingSession`. Use an `afterOpen` hook.
  - packages/slate/src/vendors/nikon/nikon-camera.ts:708-722 — hand-written session renewal. Use the lifecycle. The bench-required renewal before Record stays (see special cases); the `#movieSessionRenewal` bookkeeping goes.
  - packages/slate/src/vendors/canon/canon-camera.ts:490-492, 831-838, 507 — three advertise checks.
  - packages/slate/src/vendors/nikon/nikon-camera.ts:551-564, 365, 872-878, raw-capture.ts:10, camera-controls.ts:134-135, shot-controls.ts:96 — GetDeviceInfo and GetVendorCodes are resent per action.
  - packages/slate/src/vendors/nikon/wifi-camera.ts:30-31, wireless-status.ts:49-50, menu-controls.ts:142-145, accessory-controls.ts:107-109 — four 'is a Nikon' checks.
  - packages/slate/src/vendors/generic/generic-camera.ts:1339-1361, ptp-object-index.ts:61-69, standard-clock.ts:31-37, generic-camera.ts:982-985, 1444-1448 — four DeviceInfo caches.
  - packages/slate/src/vendors/generic/generic-camera.ts:554 and telemetry-benchmark.ts:113-115 — identity set as a side effect of opcode 0x1001.
  - packages/slate/src/camera/index.ts:95, 463-468, protocol-session.ts:27, profile-capture.ts:283 — the driver is built at construction and swapped at connect.
  - packages/slate/src/camera/index.ts:133-136, 466-467, 501-509, protocol-session.ts:133-143, camera-context.ts:27-29 — two subscription lists and an `as never` cast.
  - packages/slate/src/ptp/definitions/session.ts:1 — `randomSessionId` can return 0. Move it into session open and exclude 0.
  - packages/slate/src/ptp/transaction-channel.ts:109 and generic-camera.ts:289 — callers must remember to call `newConnection()`. The session lifecycle owns it.
  - packages/slate/src/ptp/transaction-channel.ts:11, 138, generic-camera.ts:67, 579 — DeviceBusy policy is declared in the channel but run in generic-camera. Move the loop into the channel. Canon's own DeviceBusy resend (canon-camera.ts:365-375) folds into that same policy, and its fixed 100 ms sleep becomes a readback poll.
  - packages/slate/src/ptp/transaction-channel.ts:83 and generic-camera.ts:389 — public mutable `policy`. Use configure() only.
  - packages/slate/src/vendors/canon/canon-camera.ts:324-330 — `get` polls 10×50 ms for a missing value. Await the initial inventory completion instead.

- **9. A PTP container codec in ptp/ as a leaf, and a TransportInterface that moves containers and declares link kind, evidence, physical identity and reset capability. One decorator primitive.**
  Dependencies afterwards run transport → ptp, with no transport → camera edge. Registries resolve codecs once and index by code.
  - packages/slate/src/ptp/transaction-channel.ts:211, usb-container.ts:41, ptp-trace.ts:24, recording-inspection.ts:72, generic-camera.ts:1296 — five header parsers.
  - packages/slate/src/ptp/transaction-channel.ts:43, usb-container.ts:1, ptp-trace.ts:36, recording-inspection.ts:77, ptpip-packet.ts:141 — three spellings of the container type.
  - Eight copies of the five-UINT32 parameter check: packages/slate/src/ptp/transaction-channel.ts:270 and seven others.
  - packages/slate/src/transport/ptp-trace.ts:45 — the trace ignores `dataOperationCode`, so Sony traces come out incomplete.
  - packages/slate/src/transport/ip/ip-transport.ts:22 and nikon/wifi-pairing.ts:3 — PTP/IP rebuilds USB framing.
  - packages/slate/src/transport/interfaces/transport.interface.ts:16 — a `sessionId` parameter that IP ignores, with an invented interrupt sessionId (usb-transport.ts:569).
  - packages/slate/src/camera/index.ts:451, generic-camera.ts:1366, telemetry.ts:164, telemetry-benchmark.ts:41-42, first-contact.ts:40 — instanceof checks and `telemetryEvidence` casts. Add these to the interface.
  - packages/slate/src/transport/sony-remote/sony-remote-sdk-transport.ts:47, telemetry.ts:180, recording-inspection.ts:49 — the SDK reports itself as IP, and inspection is USB-only.
  - packages/slate/src/transport/recording-transport.ts:114, ptp-trace.ts:64, contribute/observe.ts:18, 180 — three hand-written decorators that drop `resetPort` and evidence.
  - packages/slate/src/transport/sony-remote/sony-remote-sdk-transport.ts:87 — a silent no-op reset. Declare the capability.
  - packages/slate/src/transport/usb/usb-transport.ts:1, 115, 103, drivers.ts:24, benchmark.ts:124 — discovery is an instance method and imports camera identification. Make discovery a camera-layer function.
  - packages/slate/src/ptp/types/codec.ts:3 vs vendors/registry.ts:31 — two `PTPRegistry` types. Codecs take base codecs only, which also removes the duplicate getters (codec.ts:45, 49).
  - packages/slate/src/ptp/datasets/codecs/variable-value-codec.ts:30 (7 sites) — `typeof codec === 'function'`. Resolve at registry creation.
  - packages/slate/src/ptp/datasets/device-prop-desc-dataset.ts:106, device-info-dataset.ts:63, object-info-dataset.ts:72, sdi-ext…:88 — linear find by code. Add a by-code index and unknown naming.
  - packages/slate/src/ptp/datasets/storage-info-dataset.ts:16, 30 and device-info-dataset.ts:26, 47 — field order listed twice. Use field tables, like ObjectInfo.
  - packages/slate/src/ptp/definitions/event-definitions.ts:5 (and the other definition tables) — `name` repeats the key. Build from the key.
  - packages/slate/src/ptp/types/codec.ts:352, 168, transport.interface.ts:32 — the endianness parameter never varies. Remove it.
  - packages/slate/src/ptp/definitions/datatype-definitions.ts:19-54 — INT128 is mapped to uint8. Reject it instead.
  - packages/slate/src/ptp/datasets/device-prop-desc-dataset.ts:85 and sdi-ext…:37 — decode-only datasets that throw on encode. Give them a decoder-only type.
  - packages/slate/src/transport/node-recording.ts:66-83, recording-storage.ts:12-123, recording-inspection.ts:15, 35 — bundle limits and schemas are retyped. Use one schema module.
  - packages/slate/src/transport/usb/usb-transport.ts:461, 547 — two interrupt-listener retry copies.
  - packages/slate/src/transport/usb/usb-transport.ts:48 — WebUSB pending-transfer handover spread over three fields. Model it as one transfer-owner object; the constraint itself stays.
  - packages/slate/src/transport/usb/usb-transport.ts:233 — an unexplained 100 ms wait. Await the poll settling.
  - packages/slate/src/transport/interfaces/transport-types.ts:1 and device.interface.ts:1 — shallow files. Fold them into the contract module.
  - packages/slate/src/transport/transport-factory.ts:7 — a stateless factory class. Keep it as a function only while the packed-export check needs it (check-package-exports.ts:180-194), and update the docs together.

- **10. Errors are typed data, and nothing is swallowed without evidence.**
  The bridge returns typed SDK codes, drivers raise typed reasons, and background loops emit an `error` event. Optional diagnostics keep their swallow but record the failure kind.
  - packages/slate/src/vendors/sony/sdk-node-bridge.ts:101, 119, sdk-camera.ts:231-259, 737-748, media-index.ts:11 — SDK codes are matched by regex, the 36102 regex is copied, and `retryableTransfer` is set on every failure.
  - packages/slate/src/vendors/sony/sdk-camera.ts:223-261 — connect retries chosen by message regex. Retry on a typed code.
  - packages/slate/src/vendors/sony/sony-camera.ts:1215, 1668, 668, media.ts:221 — the error type is chosen by message text.
  - packages/slate/src/vendors/nikon/nikon-camera.ts:406-413, 846 — legacy bodies detected by message text. Use a typed descriptor-missing flag.
  - packages/slate/src/vendors/canon/capture-result.ts:24 — the wording is the contract. Use reason codes.
  - apps/studio/src/main/camera-service/live-view.ts:160 — `/not supported/i`. Use the typed error.
  - packages/slate/src/camera/index.ts:419-421 — the empty catch in `readOperationAvailability`.
  - packages/slate/src/camera/index.ts:494 — `refuseWhileRecording` treats a read failure as allowed. Refuse when the state is unknown.
  - packages/slate/src/vendors/camera-power.ts:59-64 — transport loss is reported as unsupported.
  - packages/slate/src/vendors/sony/sony-camera.ts:1059-1064, 1027-1046 — `waitForFocus` swallows errors, and `awaitEvent` sleeps instead of resolving on the event.
  - packages/slate/src/vendors/sony/card-storage.ts:30, recording-slots.ts:5-22, sdk-camera.ts:624, video-recording.ts:69, 79 — card and index reads hide transport failure.
  - packages/slate/src/vendors/sony/sony-camera.ts:1935-1940 — a failed haltZoom is dropped.
  - packages/slate/src/vendors/canon/canon-camera.ts:1041-1047 and nikon-camera.ts:1023 — event loops swallow failures. Emit error events.
  - packages/slate/src/vendors/canon/canon-camera.ts:288 — `recover` hides a disconnect failure.
  - packages/slate/src/vendors/nikon/wireless-status.ts:21, 65-66 — every error becomes 'not advertised'.
  - packages/slate/src/vendors/generic/storage.ts:64-76 — the error is reported only as a last String. Keep the poll and keep the typed errors.
  - packages/slate/src/workflows/shot-analysis.ts:14, 34, 45 — empty catches. These fold into fix 11's injected services.
  - packages/slate/src/transport/usb/usb-transport.ts:410 — clearHalt treats CANCELLED/ERROR as success. Narrow this to the cancelled case.
  - apps/studio/src/main/camera-service/shared.ts:174, connection.ts:179, 227, 255, events.ts:34, live-view.ts:239, settings.ts:105, video.ts:96, media.ts:65-68, body.ts:90-96, live-view.ts:74-78 — Studio catches that discard errors. Log them to Activity.
  - apps/studio/src/main/assistant/assistant-service.ts:44-50, 603-607, 703 — `withTimeout` reports failure while the command is still running. Show the outcome as unknown.
  - apps/studio/src/main/assistant/assistant-service.ts:334, 447, 802 — warm-up and template failures swallowed.
  - apps/studio/src/renderer/src/gpu/device.ts:30, 165-167, 208-210, 296 and DiagnosticsSettings.tsx:41-110 — the renderer swallows errors. Add a renderer → Activity error channel and keep the IpcResult error.
  - packages/slate/src/telemetry/server/operations.ts:37 and main.ts:64, 86 — the cause is discarded. Log the error kind.

- **11. Services are injected, library defaults are inert, and shared contracts and local state each have one owner.**
  Through CameraOptions: Logger (inert default), telemetry store, known cameras, diagnostics sink, image decoder and scene reviewer. Slate's contribute module owns installation identity, key format, transitions and the effective-sharing rule. A local-state module owns atomic writes, locks, liveness and the `DARKGRADE_HOME` root. A `UsbDeviceId` type owns VID:PID[:serial]. Afterwards core imports nothing from contribute or vendors.
  - packages/slate/src/core/logger-config.ts:9-14 and the ~30 call sites (index.ts:86, drivers.ts:24, profile-capture.ts:269, transport-factory.ts:10) — console capture is on by default.
  - packages/slate/src/core/telemetry.ts:10-65 — mutable module globals.
  - NODE_ENV checks: packages/slate/src/core/telemetry.ts:44, 195, first-contact.ts:17 (reported in two areas), contribute/settings.ts:210.
  - packages/slate/src/core/telemetry.ts:45, 59, 196 and settings.ts:189, 244, 312 — core dynamically imports contribute singletons.
  - packages/slate/src/core/logger.ts:1, telemetry.ts:5, 218-299 — core imports the vendor registry and hosts a Sony-only `sdkTelemetry`. That code moves to vendors/sony.
  - packages/slate/src/camera/index.ts:473-476 — the camera dynamically imports workflows/first-contact. Inject it as a service.
  - packages/slate/src/vendors/canon/canon-camera.ts:1074-1076 — console.log on every connect.
  - packages/slate/src/transport/usb/usb-transport.ts:458-545 and ip-transport.ts:499 — console.error, and an ignored `_logger`.
  - packages/slate/scripts/capture-profile.ts:62 — console.log is patched.
  - packages/slate/src/workflows/shot-analysis.ts:37-45, 74 — reads environment variables, probes Ollama and spawns ffmpeg itself. Inject these.
  - packages/slate/src/cli/index.ts:140, 162 and application.ts:471, 490 — CLI consent transitions are reimplemented. Use client.setConsent/withdraw.
  - packages/slate/src/cli/index.ts:129 — effective sharing is recomputed. Read status().enabled.
  - packages/slate/src/cli/index.ts:118, application.ts:227, 427, studio diagnostics.ts:39 — `slice(4, 40)`. Export an `installationIdOf` function.
  - packages/slate/src/contribute/settings.ts:112, application.ts:203, 53, collector telemetry.ts:30, 173, 209 — the key format is generated and matched five ways. Export it.
  - packages/slate/src/contribute/settings.ts:35, batch.ts:26, application.ts:68, schema.ts:43, collector operator.ts:9 — the UUID regex. Use isContributionId.
  - packages/slate/src/contribute/schema.ts:29, 87 and collector operator.ts:75-169, protocol-research.ts:49 — the transport list. Export it.
  - packages/slate/src/cli/commands.ts:125, index.ts:149 — the 2-hour literal. Use the exported constant.
  - packages/slate/src/contribute/index.ts:35, 136, node.ts:6 — the dead v1 `createContributions` client. Remove it together with its docs, README and package-export check.
  - packages/slate/src/contribute/protocol-properties.ts:5 — a frozen allowlist snapshot. Generate it from capturePropertyCodes.
  - packages/slate/src/contribute/observe.ts:47, 67 — private op-name tables. Use the ptp/vendor definitions.
  - packages/slate/src/contribute/settings.ts:39-352, durable-file.ts:6, file-ownership-store.ts:114, collector operations.ts:25 — seven atomic writes. Use durable-file.
  - packages/slate/src/contribute/settings.ts:58, 153 and file-ownership-store.ts:135, 33 — two locks and two liveness checks.
  - packages/slate/src/runtime/file-ownership-store.ts:7, 51 — leases ignore `DARKGRADE_HOME`.
  - packages/slate/src/cli/benchmark.ts:36, 60, camera-lease.ts:26, 36, recover-camera.ts:11, capture-profile.ts:20, studio shared.ts:163, settings.ts:323 — eight VID:PID parsers.
  - packages/slate/src/cli/index.ts:254, benchmark.ts:184, 230, studio shared.ts:162-169 — DARKGRADE_CAMERA read three ways. Studio receives it as configuration (also connection.ts:86, 168).
  - packages/slate/src/cli/cameras.ts:38 and benchmark.ts:63, 217 — the camera-name expression is copied.
  - packages/slate/scripts/capture-profile.ts:30, telemetry.ts:25, vite.config.ts:15 — three git revision readers.
  - packages/slate/src/runtime/http-client.ts:23 — X-Bench-Action is always sent. Make it an option that Test Bench's host passes.
  - packages/slate/src/runtime/http-client.ts:44 — literal 409 and 'HARDWARE_BUSY'. Use HardwareBusyError.
  - packages/slate/src/runtime/ownership.ts:25-66 — the lease lifetime and heartbeat literals are repeated.
  - packages/slate/src/runtime/mcp.ts:126 — the MCP version is hard-coded. Read it from package.json.
  - packages/slate/src/cli/benchmark.ts:142, 159, 260 — check-name conventions. Export the check names from the workflow, and make UploadResult the FlushResult union (benchmark.ts:133).
  - Privacy wording. Interface strings that make privacy claims get replaced with a link to the policy; the policy wording does not change:
    - packages/slate/src/cli/commands.ts:102, 118, index.ts:149, batch.ts:9;
    - studio DiagnosticsSettings.tsx:37-263, VoicePanel.tsx:182, VoiceSetupProgress.tsx:100.
  - packages/slate/scripts/camera-api-check.ts:144 — the API check does not take the lease. Take it.
  - packages/slate/scripts/camera-lease.ts:85, camera-api-check.ts:144, studio macos-camera-daemon.ts:20, connection.ts:74-119 — the respawn loop is written three times. Move the loop into Slate's `killMacCameraDaemons`; keep the retry (see special cases).
  - packages/slate/src/runtime/index.ts:4 and studio macos-camera-daemon.ts:1-3 — the daemon export goes through runtime, plus a Studio pass-through. Export it from a transport/host entry.
  - packages/slate/scripts/camera-lease.ts:19, 49 — imports test setup. Move the variable name into a shared constants module.
  - packages/slate/scripts/camera-api-check.ts:120, 87 — a fixed 2 s sleep and a swallowed restore. Poll recording state and report the restore failure.

- **12. Each command table entry in the CLI owns its handler, parsed options and dependencies (Terminal, camera chooser, stop signal).**
  Dispatch reads the table. Dependencies: packages/slate/src/cli commands → injected deps. packages/cli stays a thin wrapper.
  - packages/slate/src/cli/index.ts:323-340 — an if-chain dispatch.
  - packages/slate/src/cli/index.ts:38 — a kebab key map. Derive it from globalFlags.
  - packages/slate/src/cli/benchmark.ts:8, 18, index.ts:104, commands.ts:70 — the benchmark re-parses its flags.
  - packages/slate/src/cli/recording.ts:37, index.ts:269, benchmark.ts:210 — console bypasses Terminal.
  - packages/slate/src/cli/benchmark.ts:96, 232, 267 — two camera choosers and a direct stop hook.
  - packages/slate/src/cli/recording.ts:3, camera-operation.ts:2, cameras.ts:1, doctor.ts:1 — device helpers live in benchmark.ts. Move them to a camera-selection module.
  - packages/slate/src/cli/manual.ts:44, 61 — hand-listed environment variables and files. Generate them from the table.
  - packages/slate/scripts/recover-camera.ts:5 — a second recovery entry point. Merge it into `darkgrade camera recover` after checking Test Bench's use of exit code 3.

- **13. Studio hosts Slate's `CameraRuntime` as a `CameraProvider`. CameraService becomes a projection of Slate observations and events, split into areas that each own their state.**
  IPC and tools reach the camera through one runtime. Studio main depends on @darkgrade/slate/runtime.
  - apps/studio/src/main/tools/studio-tools.ts:471-506, camera-service.ts:176-183, media.ts:225-230 — a re-implemented queue, immediate bypass, admission and file saving.
  - apps/studio/src/main/tools/studio-tools.ts:479-505 and ipc-handlers.ts:113-136 — two paths with different state effects.
  - apps/studio/src/main/mcp/mcp-server.ts:15-50 — a `protect` copy that drops HardwareBusy. Use registerCameraTools.
  - packages/slate/src/runtime/mcp.ts:81 — `cameraArgument` exists only for Studio. It goes away when Studio is a provider.
  - packages/slate/src/runtime/ownership.ts:38 and runtime.ts:60 — `lease`/`runExclusive` pass-throughs. Studio may become the in-repo caller; otherwise remove them after checking Test Bench.
  - apps/studio/src/main/camera-service.ts:143-148 and settings.ts:17, 32, media.ts:32 — the re-entrancy rule exists only as a comment.
  - apps/studio/src/main/camera-service.ts:150-172 — a double evidence flush. Use the runtime's benchmark hook.
  - apps/studio/src/main/camera-service.ts:260-290 and the area interfaces — mirror interfaces mixed into one prototype.
  - apps/studio/src/main/camera-service.ts:38-63, 102-106, 214-257 — public mutable fields.
  - apps/studio/src/main/camera-service/settings.ts:79 and media.ts:54-69, 109 — the card pill is tied to the settings refresh.
  - apps/studio/src/main/camera-service/video.ts:91-101 and camera-service.ts:57-58 — `recording` and `recordingState` are kept in step by hand. Use Slate's state, including restore-pending.
  - apps/studio/src/main/camera-service.ts:189-210 and live-view.ts:185-205 — reconnect is written twice.
  - apps/studio/src/main/camera-service/live-view.ts:142-170 — a frame loop with its own retry policy and a zero-delay sleep. Slate's frame stream owns the retry semantics.
  - apps/studio/src/main/camera-service/connection.ts:166 and shared.ts:37 — a fixed 1500 ms hotplug wait. Probe readiness.
  - apps/studio/src/main/tools/studio-tools.ts:275-282, vision-tools.ts:18-27, ipc-handlers.ts:102-105 — 'latest frame' written three times.
  - apps/studio/src/main/tools/studio-tools.ts:81-150 and assistant-service.ts:601-666 — undo is global state. Make it a session object.

- **14. Studio passes Slate's `CameraControlState` through unchanged (label, allowedValues, writable, range, exposureTime, unrecognized). The inspector renders a table of control-id groups through one row primitive, and value matching uses Slate's aliases with no nearest-value snapping.**
  The renderer depends on @darkgrade/slate/controls types only.
  - apps/studio/src/shared/ipc.ts:19-21, 100-104, 436-438, settings.ts:43-147, connection.ts:220, studio-tools.ts:57-64, 127-131, App.tsx:320-323, SettingsPanel.tsx:122-169, preload:34-36, App.tsx:48, ipc.ts:181 — the legacy `settings` block and the setIso/setShutterSpeed/setAperture channels (reported in two areas).
  - apps/studio/src/shared/ipc.ts:107-112, settings.ts:83-91, ControlRow.tsx:37-39 — the lossy CameraControl type.
  - apps/studio/src/main/camera-service/settings.ts:83-103 and shared.ts:72-76, 120-125 — colorTemperature special-cased; Slate exposes range-derived choices.
  - apps/studio/src/main/camera-service/settings.ts:117-119 — a hard-coded re-read list. Use settingsChanged.
  - apps/studio/src/main/camera-service/settings.ts:120-129 and shared.ts:59-65 — the Sony refocus switch. Move into Slate's Sony adapter, or make it an explicit operation.
  - apps/studio/src/shared/setting-values.ts:39-65 — `matchOption` snaps to the nearest value within 1/3 stop, against AGENTS. Remove the snapping.
  - apps/studio/src/shared/setting-values.ts:25-36 and studio-tools.ts:105-113 — host value synonyms. Use Slate aliases.
  - apps/studio/src/main/tools/studio-tools.ts:155-170 — switches white balance to make Kelvin writable and guesses 5600 K. Remove both. Report unwritable instead.
  - apps/studio/src/main/tools/studio-tools.ts:177-187, 237-248 — switches to a guessed manual value. Remove it.
  - apps/studio/src/shared/setting-values.ts:52-62, exposure-stops.ts:47-113, studio-tools.ts:190-211 — the nearest loop four times. Step over Slate exposureTime on exact advertised values.
  - apps/studio/src/renderer/src/components/SettingsPanel.tsx:46, 54 and exposure-stops.ts:27-39, 77-88 — nearestIndex selection and stepping, and the index-0 sort assumption.
  - apps/studio/src/shared/setting-values.ts:6-14, studio-tools.ts:173-187, 333, intent-schema.ts:76, 143, assistant-service.ts:410 — the exposure setting list five times.
  - apps/studio/src/main/tools/studio-tools.ts:213-215 and assistant-service.ts:185 — video mode by string compare. Use the typed PhotoVideoMode.
  - apps/studio/src/main/assistant/assistant-service.ts:186-199 — its own nine control ids. Derive them from capabilities.
  - apps/studio/src/renderer/src/components/SettingsPanel.tsx:175-205, FocusPanel.tsx:19-55, LensPanel.tsx:83, RecordingPanel.tsx:118-168 — own labels. Use CAMERA_CONTROL_LABELS.
  - apps/studio/src/renderer/src/components/SettingsPanel.tsx:172-206 (and the other panels) — hand-listed ids. A group table also shows driveMode, pictureStyle, etc.
  - apps/studio/src/renderer/src/components/SettingsPanel.tsx:97-116 — the renderer re-parses vendor spellings. Use formatShutterSpeed/exposureTime.
  - apps/studio/src/renderer/src/components/PreviewQuality.tsx:33, 62 — assumes High/Low. Read the options.
  - apps/studio/src/renderer/src/components/FocusPanel.tsx:35-41, RecordingPanel.tsx:24-113, CameraPill.tsx:93-95 — 'On'/'video' literals. Use the Slate types.
  - apps/studio/src/renderer/src/components/LiveViewPanel.tsx:257-301, FocusPanel.tsx:57-60, CameraPill.tsx:131, 216 — vendor and model knowledge in the renderer. Slate reports the focus-frame default and the subject mode.
  - apps/studio/src/renderer/src/components/SettingsPanel.tsx:36-95 — ExposureDial copies the Combobox. Give the row an optional stepper.
  - apps/studio/src/main/camera-service.ts:50-51 and settings.ts:37, 75, 111 — the dead `controlProperties` map, and its stale comment at shared.ts:78-79.

- **15. Studio has one typed IPC channel table from which StudioApi, preload and handler registration are derived, one registry per Studio enumeration, per-key preference change events, and one window factory.**
  `shared/ipc.ts`, preload and ipc-handlers stop changing together; the co-change log shows 6-7 joint commits.
  - apps/studio/src/shared/ipc.ts:10-96, 431-544, preload/index.ts:29-122, ipc-handlers.ts:76-157 — the four-way list.
  - apps/studio/src/main/diagnostics.ts:63, 71 and ipc.ts:500-505 — a stringly typed action argument.
  - apps/studio/src/main/ipc-handlers.ts:53-65 and usb-experiments.ts:40, 299 — `broadcast` branches on frame channels. Give frames their own channel.
  - apps/studio/src/main/index.ts:55, preferences-window.ts:58, 122, ipc-handlers.ts:71, usb-experiments.ts:216, 308, voice-service.ts:41, vision-service.ts:188 — nine whole-object diffs.
  - apps/studio/src/main/ipc-handlers.ts:71-74 and mcp-server.ts:28 — MCP restarts on any preference change.
  - apps/studio/src/main/index.ts:16-18, ipc-handlers.ts:30-34, preferences-window.ts:67-71, perf-monitor.ts:364-365 — the renderer URL is computed four times.
  - apps/studio/src/main/index.ts:25-60, preferences-window.ts:23-66, perf-monitor.ts:328-358 — BrowserWindow options copied.
  - apps/studio/src/renderer/src/main.tsx:38-41, preferences-window.ts:74, perf-monitor.ts:89-90, 368 — bare hash routes.
  - apps/studio/src/renderer/src/components/PerfMonitor.tsx:82-128, 459-467, perf-monitor.ts:81-96, device.ts:137, 157, use-live-transcription.ts:210 — IPC labels, subsystem labels and process kinds copied as strings.
  - apps/studio/src/renderer/src/lib/vision-overlays.ts:18-138, VisionOverlays.tsx:13-113, App.tsx:80 — vision ids hand-spelled in nine places.
  - apps/studio/src/renderer/src/components/ScopesPanel.tsx:11-15, 133-139 and ipc.ts:305, intent-schema.ts:80 — SCOPES kept apart from SCOPE_IDS. Histogram.tsx/Waveform.tsx (5-7) become rows.
  - apps/studio/src/renderer/src/gpu/assists.ts:2-9, ipc.ts:309-317, ScopesPanel.tsx:147-159, LivePicture.tsx:178, studio-tools.ts:419-426 — assist ranges written five times.
  - apps/studio/src/renderer/src/voice/transcript-store.ts:29 and ipc.ts:300 — a copied union.
  - apps/studio/src/renderer/src/voice/transcription.worker.ts:50, 181, silero-voice-detector.ts:24, index.html:13, PreferencesWindow.tsx:18, mcp-server.ts:130 — URLs rebuilt from a port. IPC returns endpoints.
  - apps/studio/src/renderer/src/App.tsx:33-51 and tests live-view-recording.test.ts:25-43 — the CameraState literal written twice. Add a shared factory.
  - apps/studio/src/main/ipc-handlers.ts:36-38 and shared.ts:99-101 (+12 inline) — errorMessage. One helper.

- **16. One `LocalModelEngine` (download, sidecar spawn, health poll, stop, status) and one model descriptor per model.**
  The assistant, voice and vision services compose it.
  - apps/studio/src/main/assistant/assistant-service.ts:224-266, 766-813, voice-service.ts:19-137, vision-service.ts:49-171 — three copies of the lifecycle.
  - apps/studio/src/main/models/llama-server-process.ts:43-105, vision-sidecar-process.ts:73-128, bark-sidecar-process.ts:106-165 — three process classes. Also the dead `running` getter (llama-server-process.ts:39-41).
  - apps/studio/src/main/assistant/assistant-service.ts:226, voice-service.ts:21, 99, vision-service.ts:178, 266 — duplicate ModelCache and PythonRuntime instances. Inject them.
  - apps/studio/src/shared/speech-models.ts:12-26, model-cache.ts:87-130, model-licenses.ts:8-12 — four records per model.
  - apps/studio/src/main/vision/vision-service.ts:36-250 — `sam3` branches. Move into the descriptor.
  - apps/studio/src/main/assistant/assistant-service.ts:539-579, 743-761, 328-730 — llama timings and fetch copied. Add one llama client.
  - apps/studio/src/main/camera-service/media.ts:146-187, assistant-service.ts:770-775, voice-service.ts:142-149, vision-service.ts:136-145 — five progress throttles. One helper.
  - apps/studio/src/main/usb-experiments.ts:72-85 and metal-frames.ts:21-34 — native add-on loading copied. One loader.

- **17. The renderer gets a primitives module and one owner per feature state, and typed variants replace sentinels.**
  The primitives are formatting (bytes, path, date), a persisted store, createStore for frames, a rate meter, a typing guard, a GPU loop and uniform helper, and the WGSL float formatter. Components import from lib/ and not from sibling components.
  - apps/studio/src/renderer/src/components/CameraPill.tsx:12, PreviewDialog.tsx:10, LiveViewPanel.tsx:14, VisionOverlays.tsx:2 — sibling imports.
  - apps/studio/src/renderer/src/components/FilesPanel.tsx:8-12, PreviewDialog.tsx:41-43, CameraPill.tsx:34-37, VoiceSetupProgress.tsx:15-18, PerfMonitor.tsx:118 — five byte formatters.
  - apps/studio/src/renderer/src/components/FilesPanel.tsx:29-31, EventLog.tsx:13-15, DiagnosticsSettings.tsx:21 — the home-path regex.
  - apps/studio/src/renderer/src/components/ScopesPanel.tsx:23-42, use-resizable.ts:9-39, AppearanceTuner.tsx:24-56, use-live-transcription.ts:33-47 — localStorage copied.
  - apps/studio/src/renderer/src/lib/live-frame-store.ts:16-105 and device.ts:45-54 — store code beside createStore.
  - apps/studio/src/renderer/src/lib/latest-frame-loop.ts:48-69, live-frame-store.ts:22-34, PerfMonitor.tsx:20-38 — three rate meters.
  - apps/studio/src/renderer/src/App.tsx:231-234 and PerfMonitor.tsx:170-172 — two typing selectors.
  - apps/studio/src/renderer/src/gpu/LivePicture.tsx:92-198 and picture-shader.ts:63-79 — the positional uniform buffer. Define the layout once.
  - apps/studio/src/renderer/src/gpu/GpuScope.tsx:37-174, LivePicture.tsx:68-251, VoiceRibbons.tsx:204-222, 47, picture-shader.ts:34 — three draw-loop lifecycles and two `f` helpers.
  - apps/studio/src/renderer/src/gpu/device.ts:146-213 — two decode-newest policies.
  - apps/studio/src/renderer/src/gpu/picture-shader.ts:4 vs styles.css:38 — tally red hard-coded. Feed `--rec` in. Brand check: the AGENTS table lists no Studio row, so note it.
  - packages/slate/src/cli/terminal.ts:101 — the CLI brand gold copy. Note it in the brand table; leave the value alone.
  - apps/studio/src/renderer/src/components/RecordingPanel.tsx:75-78, LiveViewPanel.tsx:374-379, CameraPill.tsx:153-155 — one state phrased three ways. Use one label map.
  - apps/studio/src/renderer/src/components/RecordingPanel.tsx:43-61, LiveViewPanel.tsx:270-271, LivePicture.tsx:64-66 — three clocks. Count from the camera's start time.
  - apps/studio/src/renderer/src/App.tsx:249-261 and ScopesPanel.tsx:33-42 — view state split. One owner.
  - apps/studio/src/renderer/src/App.tsx:265-276, VoicePanel.tsx:207-229, use-live-transcription.ts:223-266, panel-switch.ts:20-25 — the voice lifecycle in three places.
  - apps/studio/src/renderer/src/App.tsx:83-94, 333-341 and LensPanel.tsx:53-75 — hold-to-zoom split.
  - apps/studio/src/renderer/src/App.tsx:124-126, 207, 357 and FilesPanel.tsx:63 — download progress reset in three places.
  - apps/studio/src/renderer/src/App.tsx:383-384 and LiveViewPanel.tsx:31-34, 320-324 — `locked` and `readingCard` receive the same value.
  - apps/studio/src/renderer/src/App.tsx:309-362 + panels — dead 'disconnected' branches. Trust App's gating.
  - apps/studio/src/renderer/src/gpu/GpuScope.tsx:20, 101-103 and ScopesPanel.tsx:103-138 — the dead inactive path.
  - apps/studio/src/renderer/src/gpu/device.ts:215-219, AppearanceTuner.tsx:58-66, PreferencesWindow.tsx:2-3, live-frame-store.ts:27-34, transcription.worker.ts:118-123 — import side effects. Use an explicit bootstrap.
  - apps/studio/src/renderer/src/lib/live-frame-store.ts:52-66, device.ts:215-218, vision-overlays.ts:76 — the empty-Blob sentinel. Use a typed variant.
  - apps/studio/src/main/assistant/assistant-service.ts:452-456 and intent-follower.ts:76-120 — the negative-id sentinel.
  - apps/studio/src/renderer/src/voice/transcription.worker.ts:69-102 and use-live-transcription.ts:195-205 — the empty-partial sentinel.
  - apps/studio/src/renderer/src/voice/transcript-store.ts:19, intent-follower.ts:49, use-live-transcription.ts:135-136, 199-200 — segmentation rules copied.
  - apps/studio/src/renderer/src/voice/use-live-transcription.ts:26 — SAMPLE_RATE. Use SPEECH_SAMPLE_RATE.
  - apps/studio/src/renderer/src/lib/vision-overlays.ts:61, 106 — 16 ms polling. Use onFrameTexture.
  - apps/studio/src/renderer/src/components/DiagnosticsSettings.tsx:45-50 — 5 s polling. Add a status event.
  - apps/studio/src/preload/index.ts:80-93 and metal-frames.ts:38, 58-64 — the fallback is counted on both sides. Main owns it.
  - apps/studio/src/main/assistant/assistant-service.ts:81-176, intent-schema.ts:56-156, follow-ups.ts:89-107 — five per-action tables. One action definition object, which also owns the zoom pulse at assistant-service.ts:116-117, 608-611.
  - apps/studio/src/main/camera-service/zoom.ts:32, assistant-service.ts:96, intent-schema.ts:141, follow-ups.ts:55, 102 — wide/tele. Use Slate's in/out.

- **18. Small, local fixes**
  - Slate camera:
    - packages/slate/src/camera/index.ts:53, 511-523 — unused re-exports.
  - Slate generic/workflows:
    - packages/slate/src/vendors/generic/generic-operations.ts:74, generic-camera.ts:1218-1220, storage.ts:75, video-recording.ts:7 — four sleeps. Use one.
    - packages/slate/src/workflows/video-take.ts:12 (+5) — use messageOf.
    - packages/slate/src/workflows/telemetry-benchmark.ts:44-54 — the deprecated `runCameraBenchmark`. Delete it.
    - packages/slate/src/vendors/generic/generic-camera.ts:1385 and nikon-camera.ts:1150 — the `operation` parameter. The caller wraps the error instead.
    - packages/slate/src/vendors/generic/generic-camera.ts:1122 — photo buffers sized with liveViewBufferSize. Name the units (the 244-247 comments go).
  - Slate Canon/Nikon:
    - packages/slate/src/vendors/canon/canon-camera.ts:1169-1171 — the autofocus wrapper and its duplicate constant.
    - packages/slate/src/vendors/canon/canon-camera.ts:765-768, 1258-1261 — three live-view entry points. Keep one.
    - packages/slate/src/vendors/nikon/nikon-camera.ts:1028-1049, 598-687 — the rich touchFocus/driveFocus layer. Keep the public outcome only.
    - packages/slate/src/vendors/nikon/nikon-camera.ts:1199-1200 — `code >= 0`.
    - packages/slate/src/vendors/canon/canon-camera.ts:471-478 and protocol-session.ts:161-162 — the `allowUnadvertised` flag. Becomes a separate diagnostic call.
  - Slate ptp/transport:
    - packages/slate/src/ptp/types/codec.ts:12-306, type-helpers.ts:34, event.ts:18, response.ts:7 — dead exports. Stop the `export *` at index.ts:94-100, and update the README in the same change.
    - packages/slate/src/ptp/types/event.ts:13, property.ts:13, device.interface.ts:23 — dead fields. Fix docs/getting_started/ptp-ip.mdx in the same change.
    - packages/slate/src/ptp/types/event.ts:25 — EventEmitter is exported from the main entry. Move it to core.
  - Slate surfaces:
    - packages/slate/package.json:6, vite.config.ts:64, check-package-exports.ts:11, 25 — the entry lists. Derive vite entries from package.json.
    - packages/slate/scripts/test.ts:13 and package.json:104-121 — duplicate runner commands, plus the `test:unit` alias.
    - packages/slate/src/cli/doctor.ts:24 — read the Node minimum from engines.
    - packages/cli/package.json:12, 17 — derive externals from Slate's dependencies. Fix egoroof-blowfish.
    - packages/slate/src/telemetry/server/database.ts:1 and postgres.ts:226 — the Firestore-shaped interface over Postgres. Replace with a typed key-value interface.
  - Studio main:
    - apps/studio/src/main/camera-service/shared.ts:54-55, 9 — dead constants and unused imports.
    - apps/studio/src/main/camera-service/media.ts:141-143 — a `throwIfAborted` that cannot throw.
    - apps/studio/src/main/camera-service/live-view.ts:110-134 and usb-experiments.ts:236, 278-289 — fps stats written twice.
    - apps/studio/src/main/usb-experiments.ts:1-19, 142-155, 174, 244, 303 — the USB experiment spread over 12 files, with PTP/Sony parsing. Put it behind one Slate transport option or remove it.
    - apps/studio/src/main/assistant/text-tool-calls.ts:2-6 — a duplicate ToolCall type.
    - apps/studio/src/main/assistant/assistant-service.ts:722-727, 752 — the dead `label: null` branch.
    - apps/studio/src/main/diagnostics.ts:21-44 — a migration for an unshipped format. Delete it.
    - apps/studio/electron.vite.config.ts:13-18 — unused defines.
  - Studio renderer:
    - apps/studio/src/renderer/src/components/PerfMonitor.tsx:300-370 → ipc.ts:62, 412-417, 520, preload:102, ipc-handlers.ts:86, perf-monitor.ts:227 — the dead perfTrace chain.
    - apps/studio/src/renderer/src/voice/transcript-store.ts:4 and microphone-worklet.ts:19-46 — the dead mic level.
    - apps/studio/src/shared/ipc.ts:435, 448, 459 and their preload/handlers — dead getSettings, liveViewStop and killCameraDaemon.
    - apps/studio/src/shared/ipc.ts:223-226, 446, 501-505 — unused parameters.
    - apps/studio/src/renderer/src/voice/transcription-protocol.ts:19 — unread `windows`.
    - apps/studio/src/renderer/src/components/AppearanceTuner.tsx:46-47 — an unread export.
    - apps/studio/src/renderer/src/lib/use-resizable.ts:7, 69-70 — the 'left' edge.
    - apps/studio/src/renderer/src/gpu/scope-shaders.ts:12-199 — bins/values.
    - apps/studio/src/renderer/src/components/FilesPanel.tsx:33-35, 107 — the `video` flag.
    - apps/studio/src/renderer/src/voice/intent-follower.ts:85-97 — a pass-through.
    - apps/studio/src/renderer/src/voice/use-live-transcription.ts:252-266 — a synthesized 'stopped' event. The worker reports its own stop; keep the timeout as a guard but log it.

## Special cases that stay

- packages/slate/src/vendors/camera-controls.ts:551 — Sony ISO switches gain mode. This is the exception AGENTS records; it moves inside the Sony controls adapter.
- packages/slate/src/camera/confirmation.ts:29-36 — 100 ms readback polling. AGENTS says confirm by polling and never replay a command.
- packages/slate/src/vendors/camera-controls.ts:311-315 — an unreadable shutter value stays unknown, because the rule is to never guess units.
- packages/slate/src/camera/driver.ts:243 — targeted refresh, which Nikon needs to re-read GetDeviceInfo. It survives as its own driver operation.
- packages/slate/src/vendors/drivers.ts:74 — Canon keepAlive. The body needs the heartbeat, and Canon reads it from generic options.
- packages/slate/src/vendors/generic/storage.ts:64-76 — clip discovery polls the card where there is no event watch, as the media primitive.
- packages/slate/src/workflows/first-contact.ts:56-58 and telemetry-benchmark.ts:84-102 — optional diagnostics never fail the host. They now record the failure kind.
- packages/slate/src/vendors/sony/sdk-camera.ts:726-754 — SDK 36101 'contents list still processing' is a documented asynchronous operation, so it is polled.
- packages/slate/src/vendors/sony/card-storage.ts:16-29 — the single-slot card fallback is gated by `isVerifiedFeature` (α6700, bench-verified).
- packages/slate/src/vendors/sony/media-index.ts:12-51 — repairs the SDK 2.02 pagination defect at 99/100 records.
- packages/slate/src/vendors/sony/sony-camera.ts:196-197, 946-960 — 1.5 s between movie-button transitions, because the α6700 ignores faster presses (bench finding).
- packages/slate/src/vendors/sony/sdk-node-bridge.ts:78, 141-142 — the uint64-safe number rewrite and per-command deadlines follow the operator-installed bridge's wire format.
- packages/slate/src/vendors/sony/sony-camera.ts:790-793 — the S1 dwell and S2 hold stay as shared constants until a readiness read exists. This needs bench evidence.
- packages/slate/src/vendors/canon/canon-camera.ts:502-516 — the movie-select resend on DeviceBusy is documented as idempotent, and DeviceBusy means nothing was done.
- packages/slate/src/vendors/nikon/nikon-camera.ts:852-853 — StartLiveView is retried once after WarningStatus recovery (Z5_2 §11.7.5 bench finding).
- packages/slate/src/vendors/nikon/nikon-camera.ts:706-707 — session renewal before Record, because USB card inspection leaves application mode refused. It moves into the session lifecycle.
- packages/slate/src/vendors/generic/generic-camera.ts:581 — standard DeviceBusy retry within 2 s. ISO 15740 says DeviceBusy means the operation was not performed, so retrying is not a replay. Check this against the single-attempt write rule when it moves into the channel.
- packages/slate/src/ptp/types/operation.ts:12 — `dataOperationCode` for Sony 0x101b. The container codec has to honour it.
- packages/slate/src/ptp/transaction-channel.ts:237 — accepts a CloseSession reply with transaction 0 (Leica; libgphoto2 ptp.c).
- packages/slate/src/transport/usb/usb-transport.ts:48 — the pending bulk-IN transfer handover, because WebUSB cannot cancel a transfer. It moves into one owner object.
- apps/studio/src/main/camera-service/connection.ts:74-119 — discovery and connect retries around the macOS ptpcamerad respawn race. These move into Slate's daemon handling.

## Comments

27 comment findings, covering about 60 sites. Each one goes with the fix that removes its cause; comments that only restate code are deleted as part of that fix.
- Slate camera, 6: workaround comments at protocol-session.ts:117 and generic-camera.ts:1321-1380 ('Classes are looked up at call time', 'loaded on first use'), plus the TRANSITIONAL markers at generic-camera.ts:1315 and protocol.ts:59, go with fix 1. values.ts:246, 257, 12 ('type-only imports keep it browser-safe') goes with fix 1. index.ts:85 (the console override justification) goes with fix 11. control-properties.ts:188-206, which misstates the mechanism, goes with fix 2. The restating comments at typed-settings.ts:135, 163, 254 are deleted with fix 2.
- Slate generic/workflows, 4: the dynamic-import workaround (generic-camera.ts:1321-1423) and the TRANSITIONAL block (generic-operations.ts:12-18) go with fix 1. The mislabelled clipFinalization comment (generic-operations.ts:76-77) goes with fix 5. The '// 5MB' unit comments (generic-camera.ts:244-247) go with the small fixes as named units.
- Slate Sony, 2: the `resumeShooting` and flag comments (sony-camera.ts:1232-1251) go with fix 6. The restating comments (photo-mode.ts:82, sdk-camera.ts:496, sony-camera.ts:1026, 1368) are deleted with fixes 1 and 7.
- Slate Canon/Nikon, 3: the Canon 'Initial flush complete' console.log (canon-camera.ts:1074) goes with fix 11. The Nikon session-renewal explanation (nikon-camera.ts:706-707, 997-998) shrinks to one bench-finding note in fix 8. The restating comments (canon-camera.ts:912, 397, nikon-camera.ts:271) are deleted with fix 6.
- Slate ptp/transport, 2: the restating comments (transport.interface.ts:29, property-definitions.ts:99-227, usb-transport.ts:539, variable-value-codec.ts:10) are deleted with fixes 2 and 9. The listener-copy and WebUSB comments (event.ts:39, usb-transport.ts:48) go with fix 9; the WebUSB note stays as the reason for the owner object.
- Slate surfaces, 2: operations.ts:160 (colorTemperature) goes with fix 4. benchmark.ts:133 (the UploadResult list) goes with fix 11.
- Studio main, 5: shared.ts:78-79, the stale Sony property table comment, goes with fix 14. download-llama-server.ts:3, which wrongly says 'live transcription', is fixed in the small fixes. The camera-service.ts dividers and orphaned doc comment (73-256), the dashed headers in the area files, and index.ts:90-92, which repeats the daemon explanation, are deleted with fixes 13 and 11.
- Studio renderer, 3: FilesPanel.tsx:14-16 (the compact PTP date) and ipc.ts:7, 172 ('every Slate capability has a channel', 'null on non-Sony for now') go with fixes 15 and 14. The doubled App.tsx:119/122 comment and the SEARCH_FROM comments (SettingsPanel.tsx:79, ControlRow.tsx:58) are deleted with fix 14.

## Tests

Tests are done last, after each fix's behaviour is in place. A test that follows a fix is rewritten against the new public seam: codec-encoded replies, an injected transport, device or clock. Tests that cannot fail are deleted.
- Fix 1 (driver interface):
  - Rewrite: packages/slate/tests/video-recording.test.ts:4-57 (hand-built double through protocolAccess), camera-connection.test.ts:158-165 (pins the protocolAccess back door; delete that case), canon-photo-mode.test.ts:36, 60, nikon-focus.test.ts:184-288, nikon-memory-capture.test.ts:11-46, nikon-live-view-lifecycle.test.ts:34, nikon-focus.test.ts:43. These become a codec-backed fake body.
  - Rewrite: shot-setup.test.ts:41-42, to assert confirmed control values instead of action strings.
  - Delete: 18_canon_capture_response.test.ts:49-52 (setFocusMode is never called).
- Fix 2 (typed values):
  - Rewrite: nikon-recording-status.test.ts:5-16 (encode a real 0xd0a4 descriptor).
  - Rewrite: sony-response-validation.test.ts:275-285 (Canon shutter wording), which moves to a Canon file and asserts reason codes.
- Fix 3: rewrite 17_olympus_generic_camera.test.ts:40 (asserts a constant's contents) to test discovery behaviour.
- Fix 4:
  - Rewrite: cli-camera-commands.test.ts:34 (repeats `slice`) and camera-operations.test.ts:16 (doc wording), to assert the descriptor properties.
  - Rewrite: typed-settings.test.ts:325-333 (installer repeated) to exercise one getter and setter.
- Fix 5:
  - Rewrite: card-storage.test.ts:4-10 (string op names, PascalCase replies), sony-ptp-video-recording.test.ts:7-16 (fakes the nonexistent `prepareRecordingMode`) and sony-video-recording.test.ts:13-30 (private `baseline`/`attempted`), all against one recording capability.
- Fix 6: rewrite sony-capture-sequencing.test.ts:12-64 (exact poll counts, private cache) to assert mode entry and restore.
- Fix 7: rewrite sony-sdk-parity.test.ts:65 so it actually compares SonyCamera and the SDK session through the shared session contract, or rename it. Today it cannot catch the divergences it claims to cover.
- Fix 8:
  - Rewrite: typed-settings.test.ts:61-63 (spies on `sendTransaction`) against an injected transport.
  - Rewrite: transaction-robustness.test.ts:549 (patches `waitMs`) with an injected clock.
- Fix 9: rewrite usb-interrupt-recovery.test.ts:7, 54, 57-59, usb-capture-reads.test.ts:19 and usb-transport-reset.test.ts:33 (private fields, endpoint ternary, the clearHalt swallow pinned in place) against an injectable USBDevice.
- Fix 10: rewrite sony-response-validation.test.ts:111-114, 150-152 (private `waitForFocus`/`handleEvent`) to go through autofocus and the event subscription.
- Fix 11:
  - Delete: camera-power.test.ts:15 (an unwritten field).
  - Delete with the client: the createContributions tests (contribute.test.ts:59 onward), after the docs check.
  - The ~30 tests that pass captureConsole:false lose that argument.
- Fix 13:
  - Rewrite: apps/studio/tests/camera-settings.test.ts:50-251 (Object.assign state, `as unknown` spies) against injected runtime dependencies.
  - Delete: diagnostics.test.ts:11-80 (dialog notices that cannot fail, unused mock).
- Fix 14:
  - Rewrite: assistant-tools.test.ts:17-27 to assert that nearest values are refused.
  - Rewrite: camera-focus.test.ts:70-117, removing the fake Sony focus switching and the uncalled `resetFocusPoint` assertion.
- Fix 17: rewrite tests/renderer/live-view-recording.test.ts:8-23, 73, 85-86 (five internal mocks, a copied ternary, an off-topic overlay assertion) against the shared label map, with the CameraState factory.
- Small fixes:
  - Rewrite: runtime.test.ts:244 (counts the wrong client).
  - Rewrite: runtime.test.ts:130 and cli-camera-commands.test.ts:145 (fixed sleeps → the existing latches).
  - Delete: validated-models.test.ts:18-19 (repeats `satisfies`).
  - Delete: camera-qualification.test.ts:30-33 (an allowlist restated) and camera-qualification.test.ts:15 (the legacy 'GetSet').
  - Rewrite: camera-event-observation.test.ts:40-43 and 17_olympus_generic_camera.test.ts:87 (private emitter) against the transport event path.

## Dependency graph after

- Slate:
  - camera/controls (pure vocabulary, browser) ← everything.
  - ptp (leaf: definitions, codecs, container) ← transport ← camera/driver (interface) ← vendors/generic ← vendors/<brand> ← vendors (vendor table) ← camera façade ← workflows, runtime ← cli. contribute ← cli, runtime.
  - core holds only logger, queue and inert defaults, and imports nothing above it.
- Studio:
  - shared (types, registries, IPC table) ← main (runtime host, CameraService projection, model engine) and preload (derived) ← renderer.
  - In the renderer: components → renderer/lib primitives; no sibling component imports.
  - Main depends on @darkgrade/slate/runtime and /controls; the renderer only on /controls types.
- Mutual imports each fix removes:
  - Fix 1: camera ↔ vendors (the CameraDriverInstance union, the owner back-reference); vendors/generic ↔ canon/nikon/sony (storage, capture-driver-image, GenericCamera ← SDK transport); canon ↔ vendors (root) barrel; vendors (root) ↔ workflows and nikon/sony → workflows (types move to camera).
  - Fix 2: ptp ↔ camera (UnrecognizedValues, `recognizedDescriptorValues`).
  - Fix 9: transport → camera (identification); transport/ip → transport/usb.
  - Fix 11: core → contribute and core → vendors/sony; camera → workflows (first-contact).
  - Fix 4 and fix 13: runtime → transport (the daemon re-export); Studio main reimplementing runtime.
  - Fix 15: the ipc.ts ↔ preload ↔ ipc-handlers co-change.
  - Fix 17: renderer component ↔ component.

## Order of work

1. Delete dead surface and pass-throughs (fix 18 deletions, the dead re-exports, the v1 contributions client, movie-audio, runCameraBenchmark). First trace Test Bench's use of the Sony SDK, Wi-Fi, Bluetooth remote and src/runtime entries, and update the README and docs together. Re-check: the Slate test suite and `test:package`.
2. Inert Logger defaults and injected services (fix 11). Re-check: isolated Node consumers for nonzero exits, the Slate suite.
3. The PTP container codec, the registry by-code index and the transport contract (fix 9). These are pure, and the codec tests cover them. Re-check: the Slate suite and camera:api-check on all three cameras (USB and PTP/IP).
4. The vendor table and per-session state (fixes 3 and 8). Re-check: camera:api-check on all three cameras.
5. Typed definitions (fix 2), then the driver interface with one confirmedWrite (fix 1), one vendor at a time: Canon, then Nikon (absorbing shot-controls), then Sony PTP. Re-check: camera:api-check on that vendor's camera after each one, and the whole Slate suite.
6. The body-mode primitive (fix 6), then the media lifecycle (fix 5). Re-check: camera:api-check on all three cameras, including recording, takePhoto and downloadMedia, and the bench physical CI.
7. The property catalog and the session contract (fix 7). The generated tables are reported separately. Re-check: the Sony PTP and SDK/Wi-Fi paths on the bench; keep the `SonyWifiCamera` alias.
8. Typed errors (fix 10) and operation descriptors (fix 4), then the CLI table (fix 12). Re-check: the Slate suite, `test:package`, and the CLI terminal smoke checks in packages/cli.
9. Studio: the runtime host (fix 13), then control passthrough (fix 14), the IPC table and registries (fix 15), the model engine (fix 16) and renderer primitives (fix 17). Re-check: Studio typecheck and e2e, and open the built app with a camera attached.
10. Comments go with each fix. Tests come last, rewritten against the new seams. Run the full Slate suite, Studio tests and camera:api-check on all three cameras once more.
