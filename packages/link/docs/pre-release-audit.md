# Pre-release API and complexity audit — 2026-11-20

Baseline: main `445ca938a78410059f5314d319babf2df69bbd9b`.
Scope: README/docs promises, packed library types, public camera controls,
vendor mappings, Studio consumers, history and agent guidance. One branch/PR.

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
| Link `.ts`/`.tsx` files, including tests | 79 → 300 |
| Studio `.ts`/`.tsx` files, including tests | 30 → 104 |
| Link camera source | 11 files / 6,593 lines |
| Link vendor source | 48 files / 5,825 lines |
| Link workflow source | 8 files / 744 lines |
| Link runtime source | 8 files / 568 lines |
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
| README says libgphoto2 consumes Link | Incorrect implementation relationship | Describe Link as an independent implementation with libgphoto2 as a protocol reference |
| `new Camera().connect()` opens the initially generic driver | The quickstart's automatic vendor selection promise is false | Select one actual USB identity before vendor protocol setup; preserve explicit-vendor validation and ambiguous-device rejection |
| Camera construction defaults to a terminal logger with global console/exception handlers | Embedding the library changes application behavior | Default `Camera` to an inert host logger; explicit terminal logging remains opt-in |
| USB connection dumps full device objects and loads source-relative identity tables just to print them | Embedding emits serial-bearing output and packaged lookup paths are invalid | Use the existing bounded logger for the selected USB ids; remove raw dumps and the unused formatter, retaining the actual identification registry |
| Nikon shutter interpretation appears in driver, shot controller and workflow normalization | Different sentinel spelling/handling and duplicated fraction conversion | Reuse Nikon labels and existing codecs; share one duration/angle parser and exact advertised-value matcher |
| Studio maintains a Sony-only vendor property map | Common Canon/Nikon controls are missing and mappings drift | Link owns control ids, aliases and vendor preference; Studio consumes current capabilities |
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

The stable application vocabulary is in `src/camera/controls.ts`. `exposureTime`
unifies shutter speed and shutter angle. Aliases make names searchable without
creating another primitive or changing units. Existing shutter convenience methods
retain their compact native protocol path; the new control contract provides
duration/angle conversion. A required frame-rate context handles cross-unit conversion;
Bulb, Time and flash-sync stay distinct.

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
measurements, not a future size guarantee. `dist/ptp/registry.d.ts` was 872,829 bytes:
inferred registry types are large, and that deserves a separate measured optimization
if consumer/compiler performance proves problematic. Do not weaken type inference
with `any` to make the declaration smaller.

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
and duration units separate. Final local validation passed 1,052 Link tests (54 existing skips), 28 runtime
tests, 28 diagnostics tests, two Link command tests, 66 Studio tests, the CLI
wrapper smoke, 20 basic Test Bench tests, strict package/type checks and seven
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
