# Simulation audit and camera gotchas

Audit date: 2026-10-28. Starting revision: `8d9a75f` (draft PR #20, stacked on #19). This audit exercises Darkgrade's real camera classes, operation definitions, codecs and USB/PTP-IP adapters against bounded, independently specified protocol scenarios. The new scenarios are software checks; they do not establish additional physical camera behavior.

## What the checks must prove

A resolved promise, an accepted opcode, an empty list, or a successful exchange among many incomplete exchanges is insufficient to mark a capability as supported. Capability results must retain the exact model, firmware, transport, source time/revision and evidence tier. A camera returning an error must remain distinguishable from a missing definition, missing profile data and an unsupported workflow.

The source-backed success assertions in [captured bench regressions](../tests/camera-simulation/captured-bench-evidence.test.ts) prevent previously verified setup commands from silently degrading to `unsupported` or `no-data`. Negative and malformed-wire scenarios exercise library error handling. The independently specified simulator/encoding regressions were also run against the original implementation: 28 of 40 failed there; the repaired implementation passed those 40. That comparison is software regression evidence, not a count of supported physical cameras.

## Evaluator and driver gotchas fixed

| Gotcha | Correct behavior and regression evidence |
| --- | --- |
| Generic connect and set could resolve after a rejected PTP command | High-level methods verify response codes, including session retries. `send()` still returns non-OK replies so callers can handle documented busy/retry behavior. See [capability regressions](../tests/camera-simulation/capability-evidence-regressions.test.ts). |
| Parameter codecs can encode fewer than four bytes | PTP command parameters occupy UINT32 slots. Build commands with padded slots; reject values that cannot fit or reproduce the captured word. |
| A zero-length property list could pass despite unreadable advertised properties | Compare decoded coverage with the camera/profile's advertised standard properties; distinguish incomplete evidence from genuine omissions. |
| A capture acceptance response could pass without returning media | The media capability requires returned media. Nikon's unimplemented still-media retrieval is rejected before triggering the shutter when the caller requests it. Command-only calls remain separate. |
| A property write/readback failure could skip restoration | Always attempt restoration and report both operation and cleanup/readback failures. No mutation is enabled by the guarded lab runner. |
| One successful replay could hide undefined, inexpressible or missing exchanges | Require complete replay coverage for a pass. Compare expected response/data and parameter encoding, and report missing definitions/setup explicitly. |
| Historical prose observations were treated as a chronological session | Mixed excerpts do not prove ordering or prerequisites. Known session rules remain enforced; missing setup is visible. A true unexpected reply after established setup remains a regression. |
| Event success could mean only that a callback ran | Validate the event parameters; dispose the listener and deadline on all exits. |
| A timed-out operation could overlap later capabilities | Stop subsequent capability execution after a timeout. Physical checks use the separate drain-before-cleanup runner. |
| Network simulation created terminal loggers implicitly | Use quiet transport loggers, preserving console functions and process-listener counts across repeated profile runs. |

## Nikon behavior

[Nikon command regressions](../tests/camera-simulation/nikon-command-regressions.test.ts) cover these driver changes through the actual camera class:

- Unknown selector/state, rejected property/mode/shutter/movie commands and movie-prohibition flags must not return success.
- `DeviceReady` and image-buffer waits have bounded deadlines. Those deadlines are host policy, not measured camera timing.
- A temporarily selected photo mode must be restored to video, including a failure after the selector write was accepted but readiness failed. Cached state becomes unknown before a mutating request; stale caches cannot skip restoration. PC mode restoration is attempted separately.
- Generic and Nikon partial-object transfers must make progress; zero-byte chunks and rejected transfers cannot spin indefinitely.
- Disconnect releases the transport even if live-view teardown fails.

The [SDK evidence ledger](../camera-catalog/sdk-evidence.json#nikon-z6iii-event-queue) grounds `GetEventEx` (`0x941c`). Its wire format uses a UINT32 event count and a UINT16 parameter count per event, followed by UINT32 words. Parameter 1 retains events; zero or omitted drains them. The [typed operation/codec tests](../tests/camera-simulation/nikon-event-data.test.ts) include independent byte vectors, truncation/count failures and retained/drained examples through Darkgrade. This is distinct from legacy Nikon `GetEvent` framing. No new physical Nikon event, recording or wireless validation occurred.

## Simulator and transport gotchas

| Gotcha | Correct behavior and regression evidence |
| --- | --- |
| Invalid-width, out-of-range or off-step property values could be accepted | Check datatype, signedness, byte length, enumeration and range/step constraints. Encoding overflow and truncated strings/arrays must fail. See [dataset tests](../tests/camera-simulation/ptp-dataset-encoding.test.ts). |
| Recorded writes could match arbitrary host data; recorded reads could hide changed state | Unknown write payloads remain missing data. Sufficient descriptors provide validated writable state; exact captured failures remain authoritative. |
| Repeated recorded OpenSession could always return OK | Track known session state and duplicate-open behavior. Successful close/reset clears session prerequisites; retained camera settings are separate from session/trace state. |
| Reconnect left trace cursors, queued output or delayed events behind | Reset session/trace bookkeeping and suppress stale callbacks. See [simulator regressions](../tests/camera-simulation/simulated-transport.test.ts). |
| Hidden implemented opcodes were confused with unsupported opcodes | Incomplete knowledge of an implemented hidden command remains missing data, even if complete advertised lists omit it. |
| Unverified quirks could dictate camera behavior | Unverified claims remain reference evidence and do not enforce simulator behavior. |
| Malformed containers or overlapping requests could be accepted | Validate container length/type/code/transaction and data-phase association; honor receive bounds. |
| A busy response could prevent strict transaction tracking from advancing | Valid transaction IDs advance even for busy/parameter/session errors; an out-of-sequence ID does not advance. Protocol bookkeeping cannot depend on quirk ordering. |
| Polled event mode could leak interrupt events or return an invented empty queue | Suppress interrupt delivery. A known pending event requires a recorded vendor poll dataset; no generic vendor queue encoding is invented. |
| PTP/IP could lose ownership/framing/cancellation state | Validate handshake/client ownership, data-phase framing and declared lengths; drain queued handlers and release channels on stop/disconnect. See [simulated server tests](../tests/camera-simulation/simulated-ptpip-camera.test.ts). |
| PTP/IP Cancel could be interpreted as an unexpected generic packet | Surface typed `PTPIPTransactionCancelledError` and clean transaction bookkeeping, without inventing a camera response code. |
| Idle event channels and ping storms could break timeouts | An idle event channel stays connected; command/data phases have total deadlines. Malformed/oversized framing drops the broken link. See [IP transport tests](../tests/ptpip-transport.test.ts). |

Sony's ordered SDIO phases remain documented model constraints, not proof of full capability negotiation. The earlier Canon mode-5/mode-0x15 additions remain explicit caller-selected values; there is no automatic model-wide mode guess. See [SDK boundaries](camera-sdk-evidence.md).

## Capture and import gotchas

[Capture/import regressions](../tests/camera-simulation/capture-evidence-safety.test.ts) cover:

- USB bus captures can include multiple cameras. Select an explicit device when multiple PTP devices are present; traffic volume does not identify the intended body.
- Headers can span URBs, and an URB can contain multiple containers. Preserve both cases. Reject malformed packet/block lengths, wrong data opcodes/directions and incomplete interrupt events. A missing payload must not become a code-only successful exchange.
- Check DeviceInfo model and firmware against the selected profile before adding facts. Different firmware needs a separate profile; multiple identities in one capture cannot be merged into one camera.
- Redact the DeviceInfo serial at the original byte boundaries. Keep the remaining bytes unchanged and record the transformation in provenance.
- Exclude media and unreviewed opaque vendor/authentication payloads from shareable profiles. Reviewed standard scalar controls and parsed Nikon GetEventEx are narrow exceptions. Their original traces remain private; this policy deliberately leaves unknown payloads as gaps.
- Sort historical evidence file traversal for reproducible source indices; filesystem enumeration order does not establish session chronology.
- Preserve repeated busy/error replies in captured order. Deduplicating identical exchanges changes the protocol scenario. Importing the same capture again is idempotent by its source hash.
- Imported JSON is data: profile identifiers must not become filesystem traversal paths. Validate result shape/status/source metadata before writing.
- Preserve source timestamps/revisions and multiple firmware observations across imports; reimporting an old file cannot refresh its observations. Only completed row records from one run ID can be imported from a progress log.
- USB shortcut selection must not choose the first captured profile for a shared VID/PID. Ambiguous IDs require an explicit profile, even when one candidate has stronger historical evidence.

## Reporting, identity and guarded hardware

| Gotcha | Correct behavior and regression evidence |
| --- | --- |
| A lone same-line USB candidate was assumed to be the captured body | Explicit cited catalog-model associations join profiles; manufacturer/line/model aliases must agree. Generic descriptors are not model aliases. See [identity generation tests](../tests/camera-simulation/camera-identity-generation.test.ts). |
| Unknown firmware borrowed known-version results | Unknown and known firmware observations remain separate. |
| Network-only entries or unrelated filtered line mocks disappeared | Retain network-only entries with `primaryTransport`, and drop a line representative only when that exact model is covered. |
| A whole network row replaced evidence per capability | Choose evidence per capability independently for each transport. |
| Equal-tier selection depended on file order | Prefer the newest original observation. Equal-time contradictory results remain `no-data` with explicit conflict sources, not an arbitrary pass. See [merge regressions](../tests/camera-simulation/compatibility-evidence.test.ts). |
| Combining/exporting/importing results laundered their ages or revisions | Preserve row-level source metadata through aggregation, capability records and UI display. See [source tests](../tests/camera-simulation/lab-result-sources.test.ts). |
| UI keys overwrote different firmware versions or showed a network result as USB | Keep transport/firmware rows distinct and show original per-cell evidence and conflict details. |
| A nonempty worker environment variable bypassed guarded entry | Before USB access, verify the live parent PID, hardware owner, scoped job, mapping, health and current serial through fresh bench state. |
| Serial/exclusion/alternate filters were ignored; first matching body won | Match all supported filters, pass the live serial, and refuse ambiguous matches. Release partially opened USB handles on failure. See [USB selection tests](../tests/camera-simulation/usb-camera-selection.test.ts). |
| Job heartbeats overlapped or failed after the worker completed | Serialize heartbeats, await an in-flight heartbeat during cleanup and withhold published results on lease loss. |
| A rejected run deleted prior results or uploaded stale output | Retain the last valid observation and use run-specific CI output. Refresh only newly published standalone results. |
| The registry prohibited identical VID/PID on different hosts | Scope selection to the host. Same-host duplicates require distinct serials; standalone selection must resolve the host/camera explicitly. |

## Remaining boundaries

1. Full DeviceInfo/property payloads were absent from the prior darkgrade01 traces. The fresh profiles still carry partial evidence. No camera or service was operated during this software audit.
2. The guarded adapter has software lifecycle/selection tests. It still needs physical rollout validation on a bench exposing current shared ownership. The older deployed bench must not be bypassed.
3. USB discovery/connection still assumes the first configuration/alternate when selecting PTP. Composite devices and alternate configurations need separate descriptor-aware selection and physical validation; the current selection fixes do not certify that support.
4. Proprietary poll formats and unrecorded negotiation/state transitions remain missing data. `GetEventEx` contract scenarios do not measure event timing or establish physical queue behavior.
5. The simulated PTP/IP server caps a fixture data phase at 64 MiB; that is a fixture bound, not a measured camera limit. IPTransport reconstructs complete containers within the caller's maximum length; it does not provide an incremental small-buffer IP API.
6. Response parameter tuples are not exposed by `Camera.send()` for replay comparison. Exchanges needing them remain a library gap rather than passing on the response code alone.
7. Historical source excerpts do not prove a complete continuous session, capture/media workflow, focus lock, colour/exposure quality or recording readiness. SDK listing, definition presence, command acceptance and simulation success remain separate evidence.
8. Imported result files retain the producer's declared evidence tier. Format validation does not authenticate an external producer or independently attest hardware execution.
9. A deadline cannot abort an arbitrary third-party transport whose promise never settles. The evaluator stops scheduling further work; physical execution retains ownership until its worker exits. No timeout is interpreted as successful recovery.
10. The default capability matrix does not yet exercise a complete start → recording-state readback → stop → original-media collection scenario. Add model-specific scenarios when their exact payloads and state evidence exist; command acceptance is not recording proof.
11. This is a bounded audit of the paths above, not complete protocol coverage for every catalog model. `GAPS.md` and the UI retain missing definitions, unsupported workflows and missing response data as work to do.

## Verification for this revision

- `test:simulation` and the GitHub simulation workflow include the broader driver regressions. 1,210 software tests passed across 30 files: the simulation suite plus focused Canon, Nikon, Sony, Olympus and production PTP/IP regressions.
- Package TypeScript checking, library build, generated USB identity consistency and registry validation passed. Both workflow YAML files parse.
- Ingestion against the pinned test-bench `2db7a28` snapshot reproduces all eight captured profiles exactly, including explicit catalog-model associations.
- Changed TypeScript introduces no new ESLint errors. Eleven pre-existing errors in GenericCamera/USBTransport were compared with `8d9a75f`; they remain outside these fixes.
- The compatibility UI is checked through rendered pages/API tests and its static build. No interactive browser or physical camera/service validation was performed in this audit.
