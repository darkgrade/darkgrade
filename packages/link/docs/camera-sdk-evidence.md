# SDK evidence for camera simulation

The portable [evidence ledger](../camera-catalog/sdk-evidence.json) links reviewed constraints to artifact SHA-256 values, SDK versions, native addresses or document pages, model applicability and remaining gaps. SDK binaries, extracted documentation, decompilations and full analysis bundles stay in the private investigation directory. No vendor implementation is redistributed.

These findings are static observations or documentation. They do not establish a working Darkgrade command, physical effect, recording, network session or recovery on a camera. A vendor SDK model listing also does not establish that every operation is available. For example, [Canon explicitly excludes remote capture for seven listed EOS M models](https://asia.canon/en/campaign/developerresources/sdk).

## Implemented constraint

Documented Sony A6700 and FX2 profiles now distinguish the three USB SDIO phases by exact parameters and order. The shared SDK USB path uses `9201[1,0,0]`, `9201[2,0,0]`, capability negotiation, then `9201[3,0,0]`. The generic `requires-sequence` simulator rule advances only after matching requests return OK. Interleaved discovery reads are permitted. Successful CloseSession and disconnect clear the prerequisites. Other Sony models retain their existing behavior pending review.

An early phase 3 or a control request before initialization reports missing profile data. The SDK control path does not establish which wire error a camera would return, so the simulator supplies no fabricated failure code. The rule deliberately covers phase ordering only: capability payloads, conditional protocol-version negotiation and model/firmware differences remain gaps. The phase exchanges acknowledge documented successful control flow; their omitted payloads must not be presented as captured camera replies.

## Explicit Canon codec values

`CanonSetRemoteMode` retains `ENABLE`/`DISABLE` and adds caller-selected `ENABLE_MODE_5` and `ENABLE_MODE_0X15`. Mode 5 is anchored to the R6 III captured profile; 0x15 is anchored to the documented EOS M profile. The names expose numbers deliberately: neither selects a camera, changes session defaults, nor promises capture support for a family. Tests replay the cited exchanges and verify exact UINT32 parameter bytes. The existing Canon connection policy continues choosing its existing mode.

## Constraints awaiting model scenarios

| Evidence | Consequence |
| --- | --- |
| Canon EDSDK session initialization selects different remote modes and retries | Preserve model-specific mode values. A shared vendor handshake is insufficient. |
| Canon Record API maps to vendor `d1b8` through `9110` with a structured data block | Keep SDK API identifiers/errors distinct from wire identifiers/errors. |
| Canon movie control has hardware-mode, storage-target and cleanup prerequisites | A successful property write alone is insufficient recording evidence. |
| Nikon Z6III command reference requires live view for movie start and defines a recording-prohibition property | Model application mode, photo/video state and card state independently before adding recording scenarios. |
| Nikon Z6III GetEventEx has per-event parameter counts and optional queue retention | Do not substitute the older Nikon event-poll framing. |
| Nikon SDK readme limits its module to one camera | This is an SDK process limit, not a demonstrated PTP or Darkgrade limit. |
| Sony USB connection modes have separate transfer/media capability gates | USB control success does not establish network or card-media support. |

The Nikon native defined-string search was bounded and inconclusive; its absence of matches establishes no missing features. The model configuration and command reference provide the stronger current evidence. No darkgrade02 camera was accessed for this analysis.

## Acquisition and next evidence

Existing local packages cover Sony SDK 2.02.00, Canon EDSDK 13.20.21 and Nikon Z-series 2.1.0. The [Canon release notes](https://asia.canon/en/campaign/developerresources/camera/cap/edsdk-eos-digital-camera-sdk-release-note) and [Nikon distribution page](https://sdk.nikonimaging.com/apply/) identify the reviewed versions. Additional packages require the vendors' application/download flows; no account or application gate was bypassed.

[Sony's command release notes](https://support.d-imaging.sony.co.jp/app/cameraremotecommand/en/index.html) document corrected per-model command compatibility, firmware-dependent focus-position values and possible PTP 2 command retirement from 2027. This makes firmware-scoped model evidence necessary before widening the simulation. The current rule must not be interpreted as future firmware compatibility.

For future Simulation Bench integration in Outpost, consume the portable ledger alongside profiles and test results. Show SDK/static, captured protocol and physical workflow evidence separately. Promote a finding to a model scenario only when its state, request, response and cleanup are established; keep missing data visible.
