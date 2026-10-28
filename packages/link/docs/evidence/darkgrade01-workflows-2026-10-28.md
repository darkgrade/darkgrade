# Physical TestBench workflow baseline — 2026-10-28

The [sanitized evidence record](darkgrade01-workflows-2026-10-28.json) records normal MCP workflows on **darkgrade01**, with fresh camera readbacks and preview files. These are results from the **older deployed library**, not physical validation of this PR's candidate branch. No checkout, service version, service environment or camera mapping was changed. darkgrade02 was not involved.

The running baseline was:

- `darkgrade/test-bench` `fix/demo-shot-tuning` at `b91e0654036e1a328b44aadd0032431db8f0e46a`; MCP **0.22.1**. systemd runs `src/web-server.ts` and `src/mcp-http-server.ts` from the deployed bench checkout.
- `darkgrade/darkgrade` `fix/demo-shot-tuning` at `543b5be6ba34b848e1d75ed8ea2072e993a776e5`.
- Canon EOS 80D, configured slot **`canon-r7`**, USB `04a9:3294`, camera-reported firmware **`3-1.0.3`**.
- Sony ILCE-6700, slot **`sony-a6700`**, USB `054c:0e78`, firmware **`2.00`**.

The deployed bench has no `HardwareCoordinator` module or `hardwareOwners` response. Consequently the candidate's direct guarded hardware runner could not be exercised here. All camera operations used normal MCP controls, their existing internal per-camera locks, and scoped agent jobs with heartbeats and `finally` cleanup. This does not qualify the newer ownership adapter.

## Observed workflow results

| Workflow                                  | Physical result                                                                                       | Boundary                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Power-on, operational preflight and probe | Both bodies completed fresh PTP `GetDeviceInfo`                                                       | USB enumeration alone was not counted                                                          |
| Canon advertised setting                  | Kelvin **5200 → 5300 → 5200**, independently read back after each write                               | White balance stayed `auto`; no visible colour correction is claimed                           |
| Sony advertised setting                   | **ISO 8000 → ISO 100 → ISO 8000**, with fresh native USB/PTP readback                                 | Only those two advertised ISO values were exercised                                            |
| Canon live view                           | Valid JPEG, **960×640**, **172,167 bytes**                                                            | Fresh delivered image; not proof of autofocus lock                                             |
| Sony live view                            | Valid JPEG, **1024×680**, **70,144 bytes**                                                            | Fresh delivered image; not proof of every Sony control                                         |
| Paired HDMI snapshots                     | Both **1920×1080**; Canon **37,579 bytes**, Sony **147,757 bytes**                                    | HDMI is a separate channel from PTP live view                                                  |
| Canon pre-record checks                   | `camera_preflight({plannedMinutes:1, autoSetup:false})` completed; camera/storage/audio checks passed | Overall `ready:false`; confirmation and warning items remained visible                         |
| Canon bounded test movie                  | **3 seconds**, original card file **MVI_2524.MP4**, **10,934,837 bytes**, `recordingVerified:true`    | Original card metadata/file size verified; the original was not downloaded                     |
| Audio and monitor recording               | Original contains an audio track; separate HDMI WebM **978,978 bytes**                                | EOS 80D HDMI is silent while shooting; audio-track presence does not measure microphone levels |
| Settings and cleanup                      | All Canon control values equal before/after preflight; both initial off states restored               | Four body USB companion controller power states also matched the initial state                 |

The Canon readiness result had focus/format confirmation items, Auto ISO/WB warnings and runtime-unknown battery status. The agent did not force a separate persistent take after `ready:false`. **No rejection of `camera_take_start` is claimed**, and persistent take start/stop/original collection remains untested by this baseline. Preflight's bounded card test movie is a distinct workflow.

Recording/collection implementation on the deployed `fix/demo-shot-tuning` source belongs to the separate [PR #18](https://github.com/darkgrade/darkgrade/pull/18) workstream. Keep that integration separate: this physical baseline does not establish that the candidate simulator contains or can qualify the full recording and original-collection application workflow. Full qualification needs the recording dependency, exact TestBench adapter contract tests, and a guarded candidate run after integration.

## The public interface is a workflow

A TestBench tool call can include several PTP sessions and auxiliary operations. Simulating only an accepted opcode misses that interface.

- `camera_controls` and ordinary `camera_set_iso` call `cameraControlRequest`, which posts to `/api/cameras/{label}/controls`. The bench dispatches by attached vendor, checks readiness, claims its camera action, and runs the corresponding control script under `flock`. That script constructs the Darkgrade `Camera` facade and uses `CanonCamera` or `SonyCamera` native USB/PTP methods. Ordinary Sony USB controls here were not a vendor SDK bridge path.
- `camera_set_canon_color_temperature` calls `BenchControlPlane.runCanonControl` and the Canon helper. A single labeled setter trace contains **two OpenSession, two GetDeviceInfo and two CloseSession commands**: the readiness probe and then the actual Canon session, remote/event initialization, property-cache reads, write/readback and cleanup.
- `camera_live_view_frame` goes through `runCameraAction` → `DarkgradeService.cameraAction` → locked `scripts/darkgrade-camera-action.ts` → `Camera.captureLiveView`; the returned file was copied privately and independently checked as a JPEG.
- `camera_preflight` routes to the web process's preflight endpoint. Its movie check uses `withCanonRecordingMode`, starts recording, sends stop in `finally` with retry, restores temporary movie settings, waits for the new card object and inspects its audio metadata. Its playable HDMI copy is not the camera original.

Relevant deployed sources: [MCP dispatch](https://github.com/darkgrade/test-bench/blob/b91e0654036e1a328b44aadd0032431db8f0e46a/src/mcp-server.ts), [control plane](https://github.com/darkgrade/test-bench/blob/b91e0654036e1a328b44aadd0032431db8f0e46a/src/control-plane.ts), [driver subprocesses and camera locks](https://github.com/darkgrade/test-bench/blob/b91e0654036e1a328b44aadd0032431db8f0e46a/src/services/darkgrade.ts), [Canon controls](https://github.com/darkgrade/test-bench/blob/b91e0654036e1a328b44aadd0032431db8f0e46a/scripts/darkgrade-canon-control.ts), [Sony controls](https://github.com/darkgrade/test-bench/blob/b91e0654036e1a328b44aadd0032431db8f0e46a/scripts/darkgrade-sony-control.ts), and [bounded media/recording actions](https://github.com/darkgrade/test-bench/blob/b91e0654036e1a328b44aadd0032431db8f0e46a/scripts/darkgrade-camera-action.ts).

The unexercised persistent take route uses the [video take driver](https://github.com/darkgrade/test-bench/blob/b91e0654036e1a328b44aadd0032431db8f0e46a/src/services/video-take-driver.ts) and locked [darkgrade-video-take.ts worker](https://github.com/darkgrade/test-bench/blob/b91e0654036e1a328b44aadd0032431db8f0e46a/scripts/darkgrade-video-take.ts). That source mapping is separate from the physical results above; its recording classes and original collection remain a PR #18 integration dependency.

## Advertised choices and readback gotchas

Canon ISO, aperture, shutter and white balance reported `value:"auto"`, `access:"GetSet"`, but no `allowedValues` in this recorded mode. The agent did not invent ISO choices or interpret `GetSet` alone as permission to write a particular value. Kelvin had an actual advertised enumeration containing 5200 and 5300, so it provided a restorable scalar check.

Sony ISO reported `writable:true`, `enabled:true` and exact advertised labels. Its list also contained labels of the form `Unknown ISO mode: 0x…`. Those labels were preserved as observed data and were not exercised or promoted to supported settings. A successful command acknowledgement is weaker than the separate readback and restore checks recorded here.

A movie test can report `recordingVerified:true` while full preflight remains `ready:false`. In this run `recordingSettings.settingsMatched:false` also remained explicit. Original settings were nevertheless restored, verified by complete before/after control-value equality. Do not infer exposure-mode fidelity, subject focus or readiness from a new movie file alone.

## What the USB captures establish

Three short, single-action Canon traces were archived privately. Their SHA-256 identities and media hashes are in the JSON record; raw traces, full API outputs, private identities and actual media are not committed.

The two setting traces completely captured `CanonSetDevicePropValue` **`0x9110`**, no request parameters, host data below, and an **`0x2001`** response with no parameters:

| Readback target | Host data, excluding PTP container header |
| --------------- | ----------------------------------------- |
| 5300 K          | `0c0000000ad10000b4140000`                |
| Restore 5200 K  | `0c0000000ad1000050140000`                |

The three little-endian words are dataset length 12, property **`0xd10a`**, and the scalar Kelvin value. Independent MCP readback established 5300 and its restoration to 5200. This is a narrow complete scalar exchange, not a complete camera session dataset.

The **GetDeviceInfo and property-cache data phases are absent** from these captures. The saved files use USB Linux MMAP link type **220**, snaplen **245824**, and contain **zero truncated packet records**. Missing bulk-IN completions have `flag_data='D'`, `len_cap=0`, and transfer flags **`0x00400200`**. The running kernel's headers identify **`URB_DMA_SG_COMBINED = 0x00400000`**. [Linux v7.0 usbmon](https://github.com/torvalds/linux/blob/v7.0/drivers/usb/mon/mon_bin.c#L382-L417) omits those IOMMU-coalesced scatter/gather buffers. This explains the missing captured payloads; raising snaplen or changing a parser cannot reconstruct them.

Use an application-level protocol observer, or separately validate a compatible non-SG transfer backend, when complete data phases are required. No kernel settings, USB controllers, capture service options or services were changed here. No SDK handshake capture was made. The API DTO/readback evidence must remain distinct from raw captured bytes; do not fabricate GetEvent/GetDeviceInfo datasets from these traces.

## Final state

The final fresh status reported **both cameras off, no active jobs, no recovery and no running captures**. Every mapped body USB companion port retained its initial controller-reported `powered:true` state; the paired HDMI captures remained present. Controller status is not an electrical VBUS measurement. Camera settings, USB mappings, network profiles and radio settings were not repurposed. darkgrade02 was untouched.
