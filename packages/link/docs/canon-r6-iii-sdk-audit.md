# Canon EOS R6 Mark III SDK audit

On 2026-10-13, the R6 Mark III on `darkgrade02` passed USB/PTP probes, existing exposure and white-balance round trips, and new USB live-view, preview zoom, color-temperature, and live-view AF area tests. Changed settings were read back and restored. The library changes are on `feat/canon-camera-rea`; the companion testbench integration is on `feat/camera-re-rea-canon-ui`. The sections below retain the scope and results of each dated investigation stage.

## Hardware and sources

- Camera: Canon EOS R6 Mark III, USB `04a9:3323`, hub port 3, 10 Gbps.
- Firmware reported by the official SDK: **1.0.1**. Lens: RF24-105mm F4 L IS USM.
- Library baseline: `origin/main` at `6367862`; the running bench originally used `9639a4a`.
- Sony reference: `origin/feat/sony-camera-buttons-osd` at `aa668c2`. That branch adds `pressButton`, `captureOsdImage`, and diagnostic property names. It is a comparison target, not a Canon command source.
- EDSDK **13.20.21** copied to `/home/darkgrade02/vendor-sdks/EDSDK_v13.20.21_Linux`, outside the source repositories. The SDK binary SHA-256 is `12627628897d4ff2fce6dc4b04d7c0c4d66a7c2f87c145894f56c18129cc7333`.
- SDK reference: supplied `EDSDK_API_EN.pdf`, `EDSDKTypes.h`, and the SDK's public APIs executed through Bun FFI. SDK property IDs and PTP property codes use different namespaces; equal-looking numbers are not a mapping.
- Protocol names and framing references: [libgphoto2 ptp.h](https://github.com/gphoto/libgphoto2/blob/master/camlibs/ptp2/ptp.h), [ptp.c](https://github.com/gphoto/libgphoto2/blob/master/camlibs/ptp2/ptp.c), and [library.c](https://github.com/gphoto/libgphoto2/blob/master/camlibs/ptp2/library.c), retrieved 2026-10-13. Diagnostic names alone do not establish value encoding or writability.

The earlier REA result `ev_ff6f51c51e4a66b726d4241e26c593e8c162c045c82099b52b90f3952b1f2a58` establishes the SDK's native binary overview (4,281 procedures, 10,732 strings). It does not establish individual command implementations. The functional evidence below comes from camera responses, the official SDK, and retained USB traces.

## Feature audit

| Feature | Existing Darkgrade implementation | R6 Mark III evidence and resulting change |
| --- | --- | --- |
| Session and device identity | USB PTP, Canon remote/event modes | Fresh GetDeviceInfo probes passed after every successful hardware run; 171 advertised operations. New frame/zoom APIs require their operations to be advertised. |
| ISO | Typed get/set | `auto → 100 → auto` verified. |
| Aperture | Typed get/set | `f/7.1 → f/4 → f/7.1` and `f/7.1 → f/4.5 → f/7.1` verified after fixing delayed event readback and preserving the advertised third-stop encoding. |
| Shutter speed | Typed get/set | `1/60 → 1/8 → 1/60` verified. |
| White balance | Typed get/set | `auto → auto-white → auto` verified. |
| Color temperature | Retained as unknown `0xd10a` | Added uint32 kelvin control; `5200 → 2500 → 5200` verified, including MCP. Rejects values outside advertised choices. This does not select Kelvin white-balance mode. |
| Live-view AF area/system | Retained as unknown `0xd1ba` | Added EDSDK-aligned names; `whole-area → spot → whole-area` verified, including MCP. This differs from One Shot/Servo focus mode and does not drive focus. |
| USB live-view JPEG | Canon inherited the generic unsupported method | Added EOS `0x9153` segmented payload decoder and frame capture. SDK and Darkgrade both returned complete 1088×576 JPEGs. Existing MCP `camera_live_view_frame` returned a 231,358-byte JPEG in the preview server. |
| Live-view output lifecycle | Existing host output toggle; disconnect forced CAMERA | Now preserves and restores the previous output. CAMERA was restored after frame capture. Existing HOST output remains owned by its original workflow. |
| Preview magnification | Missing | Added `setCanonLiveViewZoom`; verified `1× → 5× → 1×`. The 5× image was visually magnified (1392×928). Fresh-frame metadata confirms application; a buffered old frame is not treated as success. |
| Autofocus and shutter release | DoAf/CancelAf and released half/full presses | Implemented previously. Release sequencing has regression coverage; autofocus/capture were not re-exercised in this pass. |
| Still format | Structured Canon formats and advertised choices | Current JPEG L readable; this body/mode advertised one SD-card choice. No invented alternate was written. |
| Recording and movie format | Start/stop and structured formats | Bench history records a successful 23,303,381-byte MP4 on 2026-10-11. No new card recording in this pass. Current mode did not publish the legacy MovieFormat property; wider R6 III format support remains a gap. SDK Record value 3 is retained as observed state, not proof of active recording. |
| Media transfer | Standard object/storage APIs and guarded bench download | Implemented. `CanonCamera.captureImage()` still returns `{}` even when info/data are requested; the bench compensates by finding/downloading the new object. This remains a library API gap. |
| Keep-awake | Canon KeepDeviceOn | Existing unattended policy enabled; camera remained responsive across the audit. |
| Camera-body MENU/directional buttons | Missing | No arbitrary MENU/D-pad button command was found in the supplied public EDSDK command interface. No speculative button codes were sent. Sony's codes cannot be reused for Canon. Protocol-level support remains unverified. |
| Camera menu/OSD image | HDMI sensor visibility; no Canon USB OSD API | The new USB image is a sensor preview. It is not evidence of menu/OSD capture. A Sony-like OSD channel remains unverified. |

The SDK query attempted 140 header property IDs and read 51 in this session. Darkgrade originally decoded 36 property states and preserved 198 raw states. The new registry decoded 38 and preserved 196; **94** of those raw states now have diagnostic names. These counts measure different interfaces and are not a percentage of SDK parity. Raw diagnostic properties remain raw and are not promoted to writable controls.

## Correctness fixes

`CanonCamera.set()` previously stopped after an empty event poll. The aperture actuator's update arrived later, so a successful command could leave callers with the old value. It now rejects unsuccessful PTP responses and waits up to two seconds for a matching event value when the property was already cached. It compares encoded values so structured formats are checked as complete records. The new temperature and AF controls also require advertised choices. Half-stop and third-stop aperture codes can decode to the same name (for example f/4.5); setters now retain the camera-advertised wire value instead of choosing the codec’s last alias. Record is a command/state property, so its stop command is not incorrectly required to read back zero when the body reports standby. Disconnect still closes the transport when restoring display output fails.

Preview zoom similarly needs fresh-frame verification. The first 5× test encountered a buffered 1× frame; the final setter waits for a frame carrying the requested magnification before resolving. The subsequent hardware round trip passed.

Two bench issues affected evidence collection. Ubuntu dumpcap could not traverse the private spool parent after dropping privileges; the capture service now adds traversal while preserving the parent's other permission bits. The PTP trace decoder previously discarded outgoing submit records with Linux status `-115` (EINPROGRESS). It now accepts that status only on OUT submits and still rejects failed completions. The SDK EVF trace changed from zero decoded transactions to 50 after this fix.

## Protocol evidence

The official SDK EVF trace shows:

1. Canon property `0xd1b0` changed from 1 to 3 through `0x9110`.
2. `0x9153` received parameters `[0x00200000, 0, 0]`.
3. Two `0xa102` not-ready responses preceded an OK response carrying 239,659 bytes of viewfinder payload.
4. Property `0xd1b0` was restored to 1.

The payload contains an optional `0xffffffff` header, length-prefixed image/metadata segments, and a terminal segment. Type 1 carried the JPEG on this body; type 4 carried preview magnification. Unknown metadata is retained without guessing its semantics. The decoder rejects invalid lengths, partial headers, missing JPEGs and incomplete JPEGs. Raw movie output is not silently returned as JPEG.

The USB capture retained only a preview of the large image transfer and has one incomplete container. The complete JPEG evidence is the saved SDK/Darkgrade image, not a claim that the pcapng retained every image byte.

## Reproduce on the guarded bench

Artifacts and the leased/locked hardware runner are in `/home/darkgrade02/canon-r6-iii-audit`. SDK probes use the official API; Darkgrade probes use the shared camera lock. The runner calls MCP status/readiness, starts and heartbeats an agent job, creates a labelled trace, stops/pins it, probes afterward, and finishes the job. Do not invoke hardware tests outside those guards while the dashboard may use the camera.

```sh
~/.bun/bin/bun run ~/canon-r6-iii-audit/run-bench.ts \
  'Darkgrade: Canon USB live-view JPEG and output restore' \
  /home/darkgrade02/darkgrade-canon-r6-iii/packages/link/tests/14_canon.ts \
  /home/darkgrade02/canon-r6-iii-audit/live-view-check.json \
  --live-view --output /tmp/canon-live-view.jpg
```

The existing `bench:canon` script also accepts `--round-trip-iso`, `--round-trip-aperture`, `--round-trip-shutter-speed`, `--round-trip-white-balance`, `--round-trip-color-temperature`, `--round-trip-live-view-af`, and `--round-trip-live-view-zoom`. Run one labelled capability per trace. The zoom probe restores its observed initial magnification.

Library API:

```ts
const frame = await camera.captureCanonViewfinderFrame()
// frame.image is JPEG; frame.segments preserves raw metadata.
await camera.setCanonLiveViewZoom(5)
await camera.setCanonLiveViewZoom(1)
await camera.stopCanonLiveView()

const originalKelvin = await camera.getCanonColorTemperature()
const originalAfArea = await camera.getCanonLiveViewAutofocusMode()
// Select writes from getCanonPropertyStates().allowedValues.
await camera.setCanonColorTemperature(originalKelvin)
await camera.setCanonLiveViewAutofocusMode(originalAfArea)
```

Always disconnect in cleanup. Temperature/AF setters persist settings until explicitly restored; stopping live view restores output, not arbitrary user settings. The generic `camera.captureLiveView()` now also works for Canon.

## Retained verification traces

Manifests and pcapng files are under `/var/lib/darkgrade-testbench/evidence/traces/<id>/`. JSON results and JPEGs are under `/home/darkgrade02/canon-r6-iii-audit` and mirrored on the Mac at `~/canon-r6-iii-audit`.

| Verification | Trace ID |
| --- | --- |
| Initial Darkgrade controls | `29902b17-7ef1-4a77-9dc2-8c78e51c10f2` |
| Official SDK property inventory | `f0e4ccdf-ad1a-41aa-95b5-4810156d0517` |
| Official SDK EVF download/output restoration | `b864080e-5341-4739-9a64-34ea82a3ec5c` |
| Original Darkgrade raw inventory | `3e8b3fdc-5c75-40a8-b79f-5e7c3c801e43` |
| Darkgrade USB JPEG/output restoration | `887a0efd-c6ec-4301-92ba-88addecdf698` |
| Color temperature round trip | `66fdddeb-a922-421f-87b3-651d3932d5ef` |
| Live-view AF area round trip | `33b24046-5cdb-47a8-a60b-038f1bf16d7b` |
| Verified zoom after frame pipeline settled | `7b1819e6-ae34-46b7-bd94-5676e6a4ba79` |
| ISO round trip | `56ef1662-45ed-47b1-845f-fbd2222db236` |
| Aperture round trip with delayed-event fix | `7a79975e-4d59-4f55-8c7d-ca9df0a2c70a` |
| Aperture third-stop encoding round trip | `530b6ebc-d346-4573-8d25-6c068a13dd66` |
| Shutter-speed round trip | `c841cd3b-9bf0-4f03-99dd-4cdec120c999` |
| White-balance round trip | `ff595fed-842c-449d-b7dc-0e284b75e6aa` |
| Existing MCP frame API with new library | `2cc6e4eb-0ce4-496c-865a-7b62e0bb23fe` |
| New MCP temperature setter/restore | `06bb37c2-8fbc-433a-8d94-f47c08fb1adb` |
| New MCP AF area setter/restore | `87e85233-c7c7-4d65-b3e4-4ca1e23326d6` |

Two negative traces are retained: `861bef30-8671-4561-8913-7deaef8ac789` (zoom readback still showed an old buffered frame) and `e77ab3ea-bd54-4a9c-93e0-7b538a204b84` (aperture cache remained stale). Subsequent traces prove the fixes; these earlier failures are not passes.

## Validation and remaining work

`CanonModelId` now uses datatype `0x0006` and a `uint32` codec. The R6 III property event bytes `18 05 00 80` decode as `0x80000518`; the previous `uint16` codec truncated them to `0x518`. Hardware trace `bfab9672-474f-4c93-9fcd-f8c550752cb3` verified the correction, and 21 focused regression tests plus TypeScript checking passed. This corrects identifier telemetry; it does not change a camera setting or establish MENU control.

The explicit `camera.getCanonExtendedDeviceInfo()` API (or `CanonCamera.getExtendedDeviceInfo()`) reads advertised Canon operation `0x9108` and returns `CanonExtendedDeviceInfo`: the preserved `headerWord`, event/property code arrays, numeric supported `remoteModes`, and `trailingByteCount`. It is not called during connection. Trace `6fd88577-b9ba-48c9-a086-3c6c3202c546` verified the native reader against an independent raw probe on the R6 III: header 892, 20 events, 194 properties, modes `[0, 1, 2, 4, 8]`, and zero trailing bytes. All 38 defined baseline property values matched afterward. Capability advertisement does not establish property writability or MENU/button behavior; remote modes remain numbers without unverified labels.

Library: 25 focused regression tests pass; TypeScript passes; package build passes. Testbench: TypeScript and 91 unit/integration tests pass, including the exact MCP catalog and realistic Linux USB submit statuses. Hardware tests ran through the shared leases/locks, with settings restored and no new card writes.

The companion MCP registry adds `camera_set_canon_color_temperature` and `camera_set_canon_live_view_autofocus_mode`; `camera_controls` includes both controls and known/raw property inventories. An isolated server on port 8791 verified those tools and existing frame capture, then was stopped. That initial isolated-server check is separate from the subsequent feature-checkout bench runs recorded in the companion investigation ledger.

Useful follow-ups are Canon menu/button/OSD protocol evidence, R6 III movie-format structures, manual lens drive, histogram interpretation, richer SDK metadata mapping, and fixing captureImage's info/data contract. Those features remain separate from the verified additions above.


## REA dispatcher follow-up and HDMI UI proof

On 2026-10-13 the audit was carried onto Sony branch `5b8240d` in `~/darkgrade-canon-rea`. The Linux bench now has REA 6.4.0, Ghidra 12.1.4 and Java 21, with live Codex MCP tool listing/session identity verified. SDK SHA-256 remains `12627628897d4ff2fce6dc4b04d7c0c4d66a7c2f87c145894f56c18129cc7333`.

REA `EdsSendCommand` dossier `ev_61749dd61c085e84b1668a56d2ba970135422b68a8e9b65f512bdf20ae19573b` maps analysis address 0x2a4e60 to ELF linked address 0x1a4e60 (Ghidra image bias 0x100000). It dispatches through the SDK object rather than directly exposing PTP numeric commands. `CEdsCamera::SendCommand` dossier `ev_46ba797594c2723fbcffd62b79ffbbd8b26b25be1b7dbcff5fd64fbbadd9e812` at 0x28c700 locates the 40-entry sCommandHandler at 0x2bf2c0. Original ELF relocations/vtable entries were mapped statically; saved JSON tables cover 40 ordinary, six status and seven extended commands. No general MENU/arrow button API was found in these tables. This is bounded negative evidence, not proof that every undocumented body operation is unsupported. No unknown write/side-effect operation was attempted.

The testbench camera-back UI physically verified autofocus, 1×/5× magnification, color-temperature scene changes and AF-area round trips using Cam Link serial A29YB62434QP3V, trace `4e7d9974-34b1-4d57-8857-f6d9057de80f`. Original WB auto, 5200 K and whole-area AF restored. MENU is disabled pending evidence of a navigation protocol. See bench compatibility notes and `~/canon-r6-iii-audit/verify-canon-ui.json` for observations and screenshots.


## Publication checkpoint (2026-10-15)

The current library branch is `feat/canon-camera-rea`, built on Sony commit `5b8240d`; the companion testbench branch is `feat/camera-re-rea-canon-ui`. The additions include viewport-origin panning (`0x9159`), frame-center positioning (`0x915b`), extended capabilities (`0x9108`), the ModelId width correction, and the previously verified live-view/color-temperature/AF controls. Viewport arrows move the sensor preview; physical MENU/arrow/SET navigation and Bluetooth activation remain unverified.

Before publication, the library passed typechecking, its package build and 100 software tests across 21 files. The bench passed typechecking, its browser build, 101 unit/integration tests and 38 browser tests (one optional documentation-screenshot test skipped). Review then reproduced a separate cleanup failure: pan a magnified crop, switch to 1×, and close. Cleanup now restores magnification before writing the saved crop origin; a subprocess regression exercises the actual session script against the camera's crop constraint. This correction is software-verified; it is not a new hardware result.

The companion camera-re skill retains the later PTP/REA/native-SDK/Bluetooth investigation and negative results. No production settings-file importer or physical MENU control is included. Licensed SDKs, firmware, private configuration transfers and raw bench captures remain outside these source commits.


## Capture parity and failure recovery (2026-10-18 UTC)

The earlier Canon implementation is now on Darkgrade `main` through PR #10. The follow-up
library branch is `feat/canon-capture-recovery`; testbench integration continues on
`feat/canon-preview-mcp`.

Added `CanonCaptureDestination` (`0xd11c`) as a numeric, advertised-choice control, plus
`Camera.getCanonCaptureDestination()` / `setCanonCaptureDestination()`. PTP destination
values differ from EDSDK SaveTo: this R6 III advertised `[2, 6, 4]`, initially 2. The new
MCP setter round-tripped **2 → 6 → 2** with readback, rejected unadvertised value 1, and
finished PTP-ready. This changes the still-image target, not movie recording state. Host
selection alone does not implement EDSDK host-object delivery or announce host capacity.

`captureImage({ includeInfo, includeData })` now snapshots card handles before release,
pumps EOS events while awaiting a new completed still, reads metadata only for new handles,
and returns requested metadata/data. Capture without either field retains the shutter-only
path. Folders, empty files, old objects and movie files cannot satisfy the new-image check.
If multiple new images are ready together, JPEG is preferred; otherwise the first usable
still is returned. Waiting for a new card image is bounded at 15 seconds. Discovery or
transfer failure does not automatically repeat an accepted shutter command.

Partial-object downloads now reject unsuccessful replies, zero-byte progress, oversized
chunks and invalid byte counts. KeepDeviceOn also checks its actual PTP response code.
The new guarded MCP capture/download action verifies byte count and reports cleanup failure
instead of publishing a successful result after an unsuccessful disconnect.

**Still capture did not pass the hardware test in the current body state.** AF, non-AF,
event-pumping and combined full-release probes acknowledged but produced no new card
image. A direct EDSDK 13.20.21 non-AF shutter call returned `0x8d0c`, named
`EDS_ERR_TAKE_PICTURE_SPECIAL_MOVIE_MODE_NG` by the supplied SDK header. Its release
succeeded. EDSDK reported SaveTo=1 and AEMode=3; the newer SlowFastMode/MovieParamEx
properties were unsupported. A temporary movie-select-off probe also did not produce an
image and was followed by unresponsive PTP. No normal-mode or firmware-upgrade success is
claimed. Thus metadata/data delivery has software coverage; complete R6 III still capture
remains a hardware gap rather than an SDK-parity pass.

Actual failure tests killed an owned, idle Canon preview worker and separately disconnected
only its verified USB port and unoccupied companion. The stale session was rejected, the
worker lease cleared, failures were recorded, USB was restored and a new preview opened
successfully. A subsequent mapped Test Bench 2 power cycle recovered the separate
unresponsive mode-probe state, confirmed USB disappearance/re-enumeration and completed
GetDeviceInfo. Keep-awake was re-enabled and acknowledged. The recovery-only test verified
exposure, white balance, Kelvin, AF area and image-format values against its initial snapshot;
this is not a claim that every opaque camera setting was restored.

Evidence stays outside Git in `~/canon-r6-iii-audit/parity-recovery-hardware/`, including
`capture-destination.json`, `recovery-results.json`, `attempt-1-results.json`, the SDK probe
logs and `post-mode-probe-power-recovery.json`. No licensed SDK or private payload is included.

Validation: library typechecking/build and 138 offline tests across 23 files passed;
testbench typechecking/build and 194 unit/integration tests across 33 files passed.
The guarded MCP destination round trip and real worker/USB/power recovery checks are
recorded above. No new browser UI behavior was added.

## Still-capture rejection diagnosis (2026-10-18 UTC)

The remaining capture blocker is now observed directly in the USB reply. EOS operation
`RemoteReleaseOn` (`0x9128`) returned PTP `0x2001` with response parameter `[0]` for
half-press, then `0x2001` with `[12]` for full-press. REA of the same SDK's
`CPtpInterface::DS_RemoteReleaseOn` (Ghidra `0x22ea80`) shows it consumes that first
response parameter as the shutter result; `CPtpCamera::ReleaseSwitch` (`0x2189e0`)
translates a nonzero result with `result | 0x8d00`. This proves the observed `0x8d0c`
is a camera rejection, not a host SDK mode check or a successful shutter followed by
missing media transfer.

Darkgrade previously discarded response parameters. `OperationResponse` now preserves
optional raw uint32 `parameters`, and Canon capture/autofocus half-press handling checks
the release result in addition to the PTP response code. A nonzero result rejects the
operation, releases the pressed controls, and bypasses image polling and shutter retries.
Cameras returning no result parameter retain their earlier behavior. Result `0x0c` is
reported with the SDK name `TAKE_PICTURE_SPECIAL_MOVIE_MODE_NG`.

The earlier unsupported SDK mode-property reads were incomplete diagnostics: these
properties require distinct documented registration calls before `EdsOpenSession`.
With each property's registration in place, native EDSDK read back:

| Property | Observed value |
| --- | --- |
| FixedMovie (`0x01000422`) | 1 (movie mode enabled) |
| MovieHFRSetting (`0x0100045d`) | 0 (disabled) |
| SlowFastMode (`0x010004c7`) | 0 (disabled) |
| MovieParamEx (`0x011004c6`) | exact bytes `3018710000030000` |
| SaveTo / AEMode / AEModeSelect | 1 / 3 / 3 |

`EdsSendCommand(MovieSelectSwOFF=0x108)` returned success, but registered FixedMovie
readbacks immediately afterward and before session close remained **1**. No still
shutter was attempted in this mode-off diagnostic because the mode had not changed.
Canon's supported software switching workflow requires the physical hardware to be in
still shooting mode; the current observations do not distinguish a physical selector
restriction from another body-specific condition. HFR and Slow & Fast were already off.
There is still no verified software transition to still mode or complete new-image
capture on this body. No firmware change was made.

A real `camera_canon_capture_and_download` call through the isolated feature MCP server
now failed in **4.131 seconds total**, including readiness/session setup, with the precise
release result `0xc` / SDK `0x8d0c`, rather than timing out waiting for an image. The
paired Cam Link snapshot showed battery/PC connection icons and did not independently
reveal the physical selector. Library typechecking, build and **141 offline tests across
23 files** passed, including raw USB result preservation, rejection after either press,
control release and absence of retries. No production service was redeployed.

External evidence: `sdk-still-capture-error-static-2026-10-17.md` and
`parity-recovery-hardware/{raw-release-result.log,capture-mode-registered.log,
capture-mode-off-verified.log,release-result-mcp-verified.json,capture-gap-hdmi.jpg}`
under `~/canon-r6-iii-audit/`. Licensed SDK code and private payloads remain outside Git.

## Fresh mode-event and cold-start follow-up (2026-10-18 UTC)

The SDK FixedMovie getter uses its event cache. To rule out a stale SDK value, a labelled
USB trace observed the actual camera events around the mode-off command:
`7b71f4c0-b8ba-4ea9-b594-e0bffff9616f` completed with zero incomplete containers.
Initial event `C189 D1C2=1` was followed by a **new `C189 D1C2=1` after `9134`**.
Thus this negative result is confirmed by a fresh camera event, not just an unchanged SDK
cache. The registered SDK property callback also fired for FixedMovie.

Two additional documented paths were tested:

- SDK TakePicture command 0 sends the distinct zero-argument `910f`; it returned
  `0x8d0e` (`TAKE_PICTURE_MOVIE_MODE_NG`). The SD inventory remained 13 handles with
  unchanged free space. This path did not create a new image either.
- SetModeDialDisable command `0x113` maps to `9088`. Parameter 1 returned PTP GeneralError
  `2002`; parameter 0 returned OK but AESelect still advertised only `[3]` (Manual).
  No unadvertised AE mode was written. Mode-off afterward still emitted `D1C2=1`.
  Trace `63219b12-a4e2-4cc0-9462-ebaf23cb31f1` records the first variant; the trace above
  records parameter 0. The SDK manual's table and example disagree about the parameter's
  meaning; these observed results do not establish a working mode-dial override.

Mapped Test Bench 2 power recovery and a fresh native SDK session again reported
FixedMovie=1, HFR=0, SlowFast=0 and **firmware 1.0.1**. After the cold start, both mapped
Canon USB hub halves were disabled, USB disappearance was verified, and an immediately
archived serial-paired Cam Link snapshot was taken before restoring USB/PTP. Both HDMI
snapshots showed battery/PC connection icons, so neither revealed the physical selector.
The physical selector position remains unconfirmed.

Canon's [still shooting instructions](https://cam.start.canon/en/C022/manual/html/UG-02_ShootingStill_0020.html)
require the separate still/movie switch to be in still mode. Its
[firmware 1.1.0 release notes](https://sg.canon/en/support/0401169302) add EDSDK/CCAPI
support. The current body's older firmware is a compatibility limit, not proof that an
upgrade clears a physical movie-switch restriction. No firmware update was attempted.
The next body-side check is its actual still/movie switch position; successful still
capture and software movie/still round trips remain unverified.

Added read-only `CanonFixedMovie` (`D1C2`) and `Camera.getCanonMovieMode()`. Movie-select
methods now process pending events, avoid a mode command when the reported target is
already selected, and require a fresh matching FixedMovie event after changing modes.
An ACK with a contradictory event or no confirming event fails within a two-second
readback window, without retrying the command. On the real body, `leaveMovieMode()`
reported the explicit FixedMovie=1 rejection and left mode unchanged.

The companion USB movie-format probe/setter now preserves the initial still/movie mode,
verifies restoration, and reports disconnect failure. It no longer unconditionally
requests still mode or reports restoration on ACK alone. A live isolated MCP
`camera_probe_movie_mode` returned `originalMode: movie, restored: true`; its typed
controls exposed FixedMovie=1 and original aperture/shutter/ISO/WB/Kelvin/AF/image settings.
This validates preserving an already selected movie mode, not a successful switch to still.

Validation: library typecheck/build and **144 tests across 23 files**; bench typecheck/build
and **210 tests across 34 files** passed. Evidence remains in the external audit directory:
`native-take-picture-distinct.log`, `native-mode-dial-override*.log`,
`native-mode-dial-zero-selected-events.json`, `physical-mode-verification.json`,
`cold-firmware-and-mode.log`, `verified-mode-rejection.log`, and
`movie-probe-mode-preserved.json`. Production services remain on their existing checkouts.
