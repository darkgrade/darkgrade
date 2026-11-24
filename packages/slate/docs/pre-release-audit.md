# Pre-release API and complexity audit — 2026-11-20

Baseline: main `445ca938a78410059f5314d319babf2df69bbd9b`.
Scope: README/docs promises, packed library types, public camera controls,
vendor mappings, Studio consumers, history and agent guidance. One branch/PR.

## README contract recheck — 2026-11-23

Rechecked the built Slate package after the hardware fixes on `9026c1c`.
The existing packed ESM/CommonJS consumers still pass strict NodeNext with
`skipLibCheck:false`, including rejected operation parameters, known read-only
property writes, control ids, exposure unions and internal lifecycle methods.
That established declaration correctness, but did not protect copied README examples.

Extending the existing `test:package` checker to compile the actual documentation
reproduced four TypeScript errors: the removed `controls.exposureTime` id appeared
twice, `PropertyChanged` was not a registry event, and the live-view example passed
optional image bytes directly to `writeFileSync`. The corrected root/package README
and quickstart now pass all 26 fragments against the tarball. Fragments inherit only
typed Camera/filesystem context; the checker never executes their hardware operations.
Packed runtime checks also resolve shutter speed/angle/exposure-time aliases to the
single `shutterSpeed` id in both module formats and reject angle conversion without
the actual frame-rate context.

| Promise | Result and boundary |
| --- | --- |
| Typed library consumers | Strict packed declarations, positive inference and negative assertions pass. The connected body's value lists and mode remain runtime facts. |
| Shared controls and searchable aliases | Existing `cameraControlDefinitions`, `resolveCameraControl` and vendor property preferences supply one application vocabulary; wire names/codes remain vendor-scoped. |
| Browser support | Pure controls and documented browser diagnostics/runtime boundaries bundle; the main camera export requires Node services. |
| Automatic vendor selection | One uniquely matched USB body is selected. Multiple matches require filtering; recognition does not enable unsupported features. |
| Recording and live view | Implementations cover supported Sony/Nikon/Canon bodies. Examples and capability tables now retain body/mode/media and physical-evidence limits. |
| Inert library construction | Existing packed Node checks retain the host console and fatal-error behavior by default. Terminal rendering is explicit. |
| Installation and size/dependencies | Registry check on this date returned 404 for `@darkgrade/slate`; publishing is pending. The `darkgrade` executable is published separately. Manifest dependencies replace fixed-size/single-dependency claims. |
| Hardware stability | The separate `9026c1c` qualification passed 33 checks across the three darkgrade01 bodies, with independently decoded media. This documentation/type check does not extend that evidence to other bodies, transports, the desktop GUI or >99% reliability. |

The root README, package README, installation, quickstart, PTP introduction and
feature-compatibility docs now agree on publication, `shutterSpeed`, standard event
names and support boundaries. The root AGENTS and existing `/untangle-codebase`
workflow require the same search/consumer audit before adding a primitive and require
these documentation copies to change together. No camera implementation, wire
protocol, package or new alias registry was introduced by this recheck.

The library was named Link and lived in `packages/link` at this historical baseline.
Current instructions and import examples use Slate (`packages/slate`, `@darkgrade/slate`);
recorded revisions, source attribution and wire schema identifiers retain their original values.

## Available history and growth

This checkout is not shallow. Its oldest reachable commit is
`297f9651e12acdcea7db08a382cc496269007d7b`, dated 2026-09-11. There is no August
history here, so the measured window is September 11–November 20, not a fabricated
three-month comparison.

| Measurement at baseline | Result |
| --- | --- |
| Reachable commits in the window | 159 |
| Commits with explicit agent coauthor attribution | 131 |
| Entire repository diff from the initial commit | 718 files; 86,764 added / 7,776 removed lines |
| Slate `.ts`/`.tsx` files, including tests | 79 → 300 |
| Studio `.ts`/`.tsx` files, including tests | 30 → 104 |
| Slate camera source | 11 files / 6,593 lines |
| Slate vendor source | 48 files / 5,825 lines |
| Slate workflow source | 8 files / 744 lines |
| Slate runtime source | 8 files / 568 lines |
| Studio main source | 23 files / 5,823 lines |

These counts are growth, not a count of junk. Coauthor attribution does not establish
which lines were agent-written or whether the code is unnecessary. The largest
addition is the 9,481-line camera identity catalog. Vendor SDK property catalogs,
protocol definitions, fixtures and regression tests account for substantial growth
and must not be deleted as duplicated application logic.

Reproduce with `git log`, `git ls-tree -r --name-only`, `git diff --numstat` and
`git diff --shortstat` at the two revisions. Count source files/lines separately
from data, generated declarations, tests and infrastructure.

## Findings and changes

| Finding | Consequence | Resolution |
| --- | --- | --- |
| Main declarations use extensionless imports; only diagnostics were consumer-typechecked | Strict NodeNext camera imports fail and invalid-input checks become ineffective | Fix every emitted declaration import, including directory imports; ship referenced WebUSB/Node types; test packed ESM/CommonJS camera consumers with negative assertions |
| README/docs claim a fixed 55 kB bundle and one dependency | Readers cannot assess the actual package or its host requirements | Remove stale badges/claims; refer to the manifest and distinguish main camera exports from pure/browser exports |
| README says libgphoto2 consumes Slate | Incorrect implementation relationship | Describe Slate as an independent implementation with libgphoto2 as a protocol reference |
| `new Camera().connect()` opens the initially generic driver | The quickstart's automatic vendor selection promise is false | Select one actual USB identity before vendor protocol setup; preserve explicit-vendor validation and ambiguous-device rejection |
| Camera construction defaults to a terminal logger with global console/exception handlers | Embedding the library changes application behavior | Default `Camera` to an inert host logger; explicit terminal logging remains opt-in |
| USB connection dumps full device objects and loads source-relative identity tables just to print them | Embedding emits serial-bearing output and packaged lookup paths are invalid | Use the existing bounded logger for the selected USB ids; remove raw dumps and the unused formatter, retaining the actual identification registry |
| Nikon shutter interpretation appears in driver, shot controller and workflow normalization | Different sentinel spelling/handling and duplicated fraction conversion | Reuse Nikon labels and existing codecs; share one duration/angle parser and exact advertised-value matcher |
| Studio maintains a Sony-only vendor property map | Common Canon/Nikon controls are missing and mappings drift | Slate owns control ids, aliases and vendor preference; Studio consumes current capabilities |
| UI exposure dials invent fallback choices from third-stop tables | UI can offer settings the body has not advertised, lose exact labels, or misread angles | Dials use exact native labels, active units and current write guards; empty/ambiguous lists do not supply fallback values |
| Canon formats are structured, while Sony formats are enum labels | A generic setter can guess the wrong record or collide on display labels | Map labels back to exact advertised Canon records; reject ambiguous labels |
| A 325-line disabled “Client API” test imports nonexistent `src/node`, `listCameras` and `watchCameras` | Dead material advertises an API that cannot run | Remove it; executable discovery/driver/consumer tests cover the actual API |
| Three build/test/source aliases point at nonexistent directories | Agents can mistake placeholders for supported architecture | Remove `@api`, `@constants` and `@factories` aliases |
| Historical AGENTS instructions still pin new changes to old PRs | Future agents append work to obsolete branches or stop for stale merge restrictions | Replace campaign instructions with a current one-task/one-PR rule; retain technical evidence and guards |

The consolidation adds a small application control contract rather than another
camera framework, package, inheritance tree or capability catalog inferred from
the brand. Vendor adapters reuse existing descriptors/events, codecs, shot
controllers and setters. Raw protocol registries remain the source of wire codes.

## Public decisions before launch

The stable application vocabulary is in `src/camera/controls.ts`. `shutterSpeed`
unifies shutter speed and shutter angle. Aliases make names searchable without
creating another primitive or changing units. Existing shutter convenience methods
retain their compact native protocol path; the new control contract provides
duration/angle conversion. A required frame-rate context handles cross-unit conversion;
Bulb, Time and flash-sync stay distinct.

Review follow-up makes Shutter speed the public control name, retaining exposure time
and shutter angle as search aliases and `ExposureTime` as the physical-value type.
Generic writes return confirmed observations, and recording Start/Stop use existing
native/SDK state readers. A single bounded read-only confirmation helper raises
`CameraConfirmationError` for missing/mismatched state; transport errors remain distinct.
This application-level mismatch has no equivalent among the wire-level PTP errors.
The existing runtime queue was extracted for reuse by camera/SDK control workflows,
rather than introducing another ordering implementation. Studio consumes confirmed
observations and retains pending Stop/setup cleanup; Test Bench no longer duplicates
Slate admission and readback. Discarded drivers detach telemetry, and internal lifecycle
helpers are excluded from packed declarations.

`getCapabilities()` is a current observation, not a permanent camera-model trait.
Its `advertisedOperations` is the standard DeviceInfo inventory, not a claim of
implementation or qualification. Writes refresh discovery and retain vendor guards.
No implicit camera-mode switch, nearest-enum rounding, power cycle or host lease is
added. Native angle writes require verified idle state and readback.

The adapter scope includes native PTP: Sony USB, Nikon photo/movie controls,
Canon common controls/structured formats and standard PTP. Sony's licensed SDK
bridge implements the same connected-session control contract through its existing
mapping; its unavailable PTP operation inventory is explicitly `null`. Native Nikon
angle hundredths and Sony SDK angle thousandths remain inside their adapters.
SDK connection/authentication remains advanced transport-specific behavior. Do not
advertise pairing/recording/media parity merely because settings share the contract.
Likewise, low-level vendor classes, registries and `getInstance()` remain protocol
escape hatches. New application code must use the generic control contract.

Concrete protocol definitions provide static parameter/value types. Body-specific
choices, writability and physical switch positions are runtime facts. “Full type
safety” cannot mean a string is supported by a camera that has not been connected.
The README now makes that distinction.

The full main export has Node dependencies; `/controls`, `/runtime/browser` and
the documented diagnostics exports provide tested browser boundaries. During this
audit an intermediate build's root ESM entry alone measured 211,136 bytes / 62,028
gzip bytes, before its shared chunks and dependencies; its packed package measured
729,150 compressed / 4,517,612 unpacked bytes across 401 entries. These are dated
measurements, not a future size guarantee. `dist/ptp/registry.d.ts` was 872,829 bytes. The follow-up replaces repeated inferred
spread returns with named shapes referencing the existing registries; it now measures
5,370 bytes, retaining exact operation/property/event codecs and last-definition-wins
merge semantics. Packed enum and parameter assertions verify that the reduction does
not widen values to `any` or arbitrary strings.

## Verification and remaining limits

The baseline strict camera consumer failed with missing declaration extensions
and unused negative assertions. The corrected packed consumer passes positive
inference and rejects invalid required parameters, property values, control names
and exposure unions under strict NodeNext without `skipLibCheck`.

Regression coverage includes real DeviceInfo/Nikon descriptor codecs, extended
32-bit property ids, photo/movie and angle/duration modes, fractional frame rates,
Auto ISO, absent/read-only controls, busy/malformed replies, failed readback,
recording guards, USB vendor selection, SDK angle conversion/readback, Canon
structured formats, Sony display-only descriptors and inert library construction. Studio
checks preserve native choices, reject fallback/ambiguous values and keep angle
and duration units separate. Follow-up local validation passed 1,076 Slate tests (54 existing skips), 28 runtime
tests, 28 diagnostics tests, two Slate command tests, 66 Studio tests, the CLI
wrapper smoke, 21 basic Test Bench tests, strict package/type checks and seven
security checks. Studio's main/preload/renderer bundles and the basic Test Bench
build passed. The initial Studio bundle command used the wrong working directory;
the corrected check used the installed project binary and passed.

These checks are synthetic/consumer regression evidence. They do not establish
new hardware support, SDK parity, uninterrupted fleet availability or >99% reliability.
Retain independent Matrix/Fleet and camera/media evidence separately from unit
tests. Failed prior hardware runs are not converted into passes by this refactor.

AGENTS.md and the repository's `/untangle-codebase` workflow require an existing-code
audit before another primitive, update consumers with the shared implementation,
and tie README promises to actual package/host validation.


## Deeper dead-code and duplication pass

The first pass was an API correction and targeted consolidation, not an exhaustive
reachability audit. This follow-up examines tracked TypeScript/JavaScript import and
re-export edges, literal dynamic imports and worker URLs across the workspace. Roots
include public package entries, Studio main/preload/renderer and workers, Test Bench,
MCP stdio and manifest-backed maintenance commands. TypeScript unused-local/parameter
checks and token comparisons identify internal leftovers and repeated implementations.
A file referenced only by its own tests is not thereby production code.

| Confirmed finding | Removal or consolidation |
| --- | --- |
| Full Linux USB name database and supplemental ids have no reader after the formatter removal | Remove 101,315 JSON lines (3,010,289 bytes), its unused generator/class labels and the orphan `usb-ids` command; retain the cited camera identity catalog used by discovery |
| Eight numbered experiments are neither tests nor supported commands | Remove `06_storage`, `07_nikon`, `10_capture`, `11_protocol`, `12_canon`, `13_canon`, `15_nikon_photo_video_mode`, `16_nikon_photo_video_test`; current profile/media commands and executable wire/consumer tests supersede their behavior |
| Native Sony control helper has only its own test as a consumer | Remove the helper/test after checking current core, Outpost, Fleet Bench and Matrix references; snapshot copies in Matrix are not callers and remain independent |
| Standard, Nikon and Sony drivers duplicate the entire chunk transfer loop | Keep native requests/offsets, preparation and response checks in each driver; share assembly, short-chunk progress, cancellation and size checks in the existing driver |
| Failed/cancelled downloads leave logger transfers active forever | Complete aggregate transfer logs as failed and release retention pins; preserve the original failure and never label an incomplete download successful |
| Sony/Nikon repeat identical subscription methods; live listener mutation skips observers | Inherit the existing generic methods and dispatch a snapshot; test listener removal/addition while delivering actual camera events |
| Terminal exception handlers suppress fatal exits (isolated Node probes returned 0 for both a throw and a rejection) | Remove those handlers; packed ESM/CommonJS terminal-logging consumers must report the actual error and exit nonzero |
| Terminal renderer keeps a second unbounded history after logger eviction | Render the logger's current retained items, release observers on unmount, and remove unused console/stdout state |
| Root/nested array formatting and Sony enum decoding repeat loops | Share each existing module's implementation, preserve formatter output and raw fallback behavior |
| Nikon shot labels repeatedly reconstruct registries/codecs per enum value | Resolve the registry and codecs once per observation and decode each distinct raw value once |
| Test Bench independently selects vendor property names and caches Sony ISO choices | Consume Slate capabilities and generic writes; keep session-scoped Sony gain-mode/choice handling in Slate, with fresh write validation and rollback |
| Build/test aliases are maintained as copies; three dev dependencies are unused | Read aliases from the existing TypeScript paths; remove `glob`, `string-similarity`, and the empty `@types/usb` stub; keep the frozen lockfile reproducible |
| Transport factories copy IP options and advertise unimplemented USB/retry flags | Reuse the actual IP interface, remove ignored option fields/common bag and construct transports without taking over the console; packed negative option assertions enforce it |
| Codec type extraction lists concrete/custom fallbacks already matched by `CodecInstance` | Use the two structural builder/instance cases and retain strict packed enum assertions |
| An abandoned `nukeDevice` reset method remains behind a commented call | Delete it; preserve the guarded recovery path and its existing tests |

Manual classification matters: seven modules outside library/app roots are reached by
the manifest-backed profile/recording commands. Their encrypted private traces,
sanitization, explicit capture and qualification contracts differ from the shared
telemetry benchmark; they remain. SDK/vendor catalogs, USB matching, mode/session
ownership, recovery guards, generated camera identities and independent parser fixtures
also remain. Public escapes are not deleted just because this repository lacks an
application caller: external consumers can use exported APIs.

The packed check exposed directory imports ending in several `..` segments after
registry types started referencing named definitions. Fix declaration rewriting for
those roots as well as simple `.`/`..`, and retain strict ESM/CommonJS consumer checks.
Sony's previously test-only enum assertions now run against packed declarations.
Source compiler checks alone did not catch this packaging failure.

The prevention gate now enables `noUnusedLocals` and `noUnusedParameters` for Slate,
including its source/tests and runtime typecheck. It catches unused local state, imports
and parameters; it does not prove that an exported API, dynamic entry or a cycle of
modules is unused. Future sweeps must follow roots and inspect external harnesses before
deleting them, and report generated data separately from executable-code savings.


Follow-up validation includes the full Slate/runtime/diagnostics/CLI suite, Studio types
and 66 tests, its actual main/preload/renderer bundles, the basic Test Bench build and
21 host tests, seven Chrome fixture HTTP/UI checks, strict packed ESM/CommonJS types,
fatal-exit injection checks, and security checks. Existing physical-test skips remain
explicit; fixture browser runs and type checks do not establish hardware reliability.
