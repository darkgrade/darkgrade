# Slate

Read the root [`AGENTS.md`](../../AGENTS.md) first: its rules apply here too, and this file only adds
to them.

Notes for work inside `packages/slate`. The repository-wide rules are in the root `AGENTS.md`;
telemetry and collector rules are in `apps/contribution-collector/AGENTS.md`.

## Where things live

Diagnostics live in `packages/slate/src/contribute` and are exported as
`@darkgrade/slate/contribute` and `/contribute/{application,batch,node,protocol,schema,settings,installation-store}`.
Use `@contribute/*` for imports inside Slate. Node settings stay separate from browser clients.
The Node diagnostics tests live in `packages/slate/tests/contribute` and run in Slate's full
test suite or with `bun run --cwd packages/slate test:contribute`.

The shared camera runtime (operation ordering, leases, the common MCP tools) lives in
`packages/slate/src/runtime` and is imported as `@darkgrade/slate/runtime` (`/browser`, `/mcp`,
`/ownership`). There is no `packages/runtime`: put new camera code in Slate. Its tests run under
Bun (`bun run --cwd packages/slate test:runtime`, which builds first) because they check package
resolution with Bun's bundler; Vitest excludes `tests/runtime`. Hosts that load it by path
(Test Bench) use `packages/slate/src/runtime/index.ts` and `mcp.ts`. A host hands the runtime its
Camera (`CameraProvider.camera(id)`, with `discover`, `assertAllowed` and optional `saveFile` and
`benchmark`) and the runtime runs every operation through that Camera; HTTP hosts serve
`POST /api/cameras/<id>/operations/<name>`, `/api/cameras/discover` and
`/api/cameras/<id>/benchmark`. Hosts keep no vendor tables and no tool list of their own.
DeviceInfo carries numeric lists as `operationsSupportedRaw`, `eventsSupportedRaw` and
`devicePropertiesSupported`; there is no `operationsSupported` or `devicePropertiesSupportedRaw`.
Two recoveries read fields that do not exist and their tests faked them. Build test replies with
the real codec.

## Tests and the attached camera

To check the public API on real cameras, run `bun run --cwd packages/slate camera:api-check`
(every attached Sony, Canon and Nikon, in parallel, once) and follow `docs/camera-api-check.md`.

`bun run --cwd packages/slate test` never opens a camera: hardware tests run only with
`SLATE_HARDWARE_TESTS=1`, and without it native USB enumeration reports no devices
(`tests/setup/`). Anything that opens a USB camera runs under the shared lease:
`bun run --cwd packages/slate camera:lease -- <command>` waits for exclusive use across every
checkout and worktree (`~/.darkgrade/leases`), stops the macOS camera daemons while it runs, sets
the variable and always releases. `check:guards` (in `test` and
`test:package`) is strict: it fails on any vendor-named main-entry export or Camera member (raw
access is `protocolSession(camera)` from `@darkgrade/slate/protocol`), on a file whose
`any`/`as never`/`as unknown as` count differs from its budget (lower it with `-- --update`), and
on a Camera method missing from the generated operation list or without a doc comment. The MCP
tools (`src/runtime/mcp.ts`) and `darkgrade camera <command>`s (`src/cli/commands.ts`) are generated
at build time from Camera's signatures and doc comments (`scripts/generate-camera-operations.ts`,
into `build/generated/`) through `src/runtime/operations.ts`: document a method's inputs on Camera,
never add a tool by hand.

## Driver invariants

The Camera façade must open USB through the driver's existing `connectTransport` lifecycle.
Opening the raw transport bypasses event subscription, channel reset and per-connection
diagnostic/identity cleanup. Test disconnect/connect and recover/connect on the same Camera,
not only fresh objects. Nikon control writes refresh the requested descriptor and its live
mode/availability guards; do not reread unrelated descriptors or admit writes from a cache.
Studio preserves last observations after a failed refresh with choices disabled, clears them
on disconnect, and replaces them only after a successful inventory.
`setControl()` returns confirmed observations; consumers display those values instead of
optimistically applying requests or repeating admission/readback in each host. Shutter speed
is the public control name; exposure time and shutter angle resolve to it as search aliases.
Recording transitions use existing vendor state observations and the shared host queue;
missing telemetry never proves idle. Confirmation polls reads, never replays a command.
Keep Stop available and preserve the connection/mode if stopping cannot be confirmed.
On Nikon reconnect, a fresh recording observation preserves the known interrupted PTP
session. Closing that session first restores photo/application modes and can make Stop
hang. Reuse the existing recording-status parser; unreadable or unknown ownership must
preserve the session and report an error rather than closing it or inventing its id.
Nikon still captures need a bounded readout allowance after a 30-second exposure.
Poll readiness without replaying the release, and test delayed completion before RAW
or photo/movie mode restoration rather than asserting success at the shutter response.
Sony native movie states 2 and 3 mean recording failure and interval-recording waiting,
not starting/stopping or idle. Card-present status does not prove free movie capacity.
Interpret a readable zero remaining-movie-time only in an observed recognized movie
mode or during recording; Sony's virtual PTP storage byte capacity is not card free space.
Recording preparation uses advertised generic mode controls, keeps the original mode,
and restores only after confirmed idle. Never format or delete existing footage to
make tests green; owned test artifacts require complete verified backups and exact targets.
Sony's shipped exposure-mode sample admits bounded idempotent reconciliation. Explicit
mode preparation allows one extra mode selection only after typed confirmation failure
and fresh idle, unchanged old mode, writable status and advertised choices. Generic control
writes and Record/Stop/capture remain single-attempt. Unknown outcomes and transport errors
never admit reconciliation; retain the first failure and require observed equality.
Detach discarded driver telemetry before constructing its replacement. Internal transport
lifecycle helpers must stay absent from packed public declarations.

## Bench findings

Sony originals over 4 GiB (2026-11-14): ObjectInfo reports 0xffffffff. Support is read from
DeviceInfo `operationsSupportedRaw` (there is no `operationsSupported` field; a test that fakes
one proves nothing). The bench FX2 advertises GetObjectPropDesc but answers 0x2005; its size
comes from GetObjectPropList for the exact handle and ObjectSize, typed UINT64. A 5,101,088,166
byte FX2 original was sized, transferred, collected and fully decoded. The a6700 splits at 4 GB.
EOS R6 Mark III with its lever at Movie cannot be put in still mode over PTP: Canon's SDK
reference (6.9.5) requires the hardware in still position, and on firmware 1.0.1 every tried
route left FixedMovie at 1 (MovieSelectSwitchOff, writing 0xd1c2, remote modes 0x11/0x15, AE
mode writes under dial override). Do not spend more bench time on it without new information.
Focus refusals say what the body reported: a Sony focus timeout includes the last focus status
and a Canon refusal names the SDK reason. Sony bodies in movie mode stayed at UNLOCK on a
half-press in bench tests, so focus confirmation was never obtained there.

Canon sessions send advertised KeepDeviceOn automatically every ten seconds through the
existing serialized event loop. Camera({keepAlive:false}) disables this session heartbeat;
no saved body power setting is rewritten. Explicit KeepDeviceOn rejects non-OK responses.
Nikon USB reference Z5_2UsbMtpE_01 §2.2 says PC connection disables meter auto-off already.
Its §11.7.5 documents one release command to clear a recoverable WarningStatus bit-0
sequence error. Slate retries live-view startup once only after that exact warning,
idle movie/buffer state, advertised operations and fresh clearing readback. Other
hardware errors remain errors. SDK documents stay private; attribution in the workspace
camera-keepalive-2026-11-13 report must remain. Physical user actions can race warning
reads; recovery may release a shutter if someone clears the warning first.

Canon movie workflows prepare a camera-advertised card destination before movie selection,
restoring prior host routing after safe cleanup. This follows the Canon EDSDK sample and
libgphoto2 card-target enumeration; it is not proof of the R8 Mark II failure's root cause.
Numeric Canon property-write telemetry retains intent, transaction and response separately
from observed state. Deploy the matching collector and Matrix contract before rolling out
this Slate candidate. Preserve real versus simulated evidence.

## Private camera recordings

`recordFullTransport` wraps the chosen transport before Camera construction and records all
sent/received bytes, events, operation timing and failures. It does not open another session.
`createRecordingBundle` requires an external 32-byte AES key/key ID (or injected
DARKGRADE_RECORDING_KEY base64 plus DARKGRADE_RECORDING_KEY_ID) and writes v2 encrypted
blobs, encrypted provenance, a durable journal and an initial incomplete manifest.
Never store the key in a recording bundle. Inspection can recover interrupted durable
entries without plaintext extraction and always reports those runs incomplete;
storage loss invalidates completeness without preventing camera cleanup. Full traces can contain
private image/identity metadata. Never commit the blobs or publish them through Matrix.

Use the existing `bench:profile` command with `--recording-directory NEW_DIRECTORY` for an
explicit recording. `--initialize --take-photo --autofocus true|false --live-view` requests a still
and live frame as well as the profile; this writes a photo and requires normal bench ownership.
The profile output stays sanitized. The private recording stays separate and requires independent
media decoding before asserting image validity. A complete recording can include failed operations:
completeness describes preservation of evidence, not camera compatibility. Never run on page open.
Outpost's private recording utility archives/restores these bundles through the existing Drive
connector. Keep contributor/source attribution attached, and do not infer a lender or person.

## Fuzz checks

Run `bun run --cwd packages/slate test:fuzz` for reproducible PTP input mutation checks.
The fixed seed `0x4d415452` covers standard/Sony descriptors and Canon/Nikon event records,
including truncated views into larger buffers, invalid offsets and string length boundaries.
These synthetic parser checks neither contact hardware nor certify model support. Matrix keeps
independent copies of the wire seeds in its fixed candidate harness so driver changes cannot
silently weaken their own regression gate.
