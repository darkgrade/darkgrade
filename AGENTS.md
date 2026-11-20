# Audit before adding code

Before adding a primitive, command, property map, parser, retry loop, package or helper,
search its canonical name, aliases and existing consumers. State in the PR which existing
implementation was reused and why a new abstraction is necessary. Consolidate an existing
primitive and its callers together; do not add a parallel implementation for a new harness.
Use the workflow in `.claude/commands/untangle-codebase.md` regardless of agent harness.
Read `packages/link/docs/pre-release-audit.md` for the measured audit and decisions.

Application controls use `Camera.getCapabilities()` and `Camera.setControl()`. Canonical
ids/labels/search aliases are in `packages/link/src/camera/controls.ts`; vendor property
preference is in `src/vendors/control-properties.ts`. Studio and test harnesses consume
Link rather than adding vendor tables. `exposureTime` covers shutter speed and angle;
conversion requires the actual frame rate. Never guess units, switch modes implicitly,
round a requested control to the nearest enum, or treat registry presence as availability.
Preserve Bulb/Time/flash-sync, current read-only/empty/ambiguous choices, idle/session guards
and failed readbacks. Different transports must not claim parity without adapter evidence.

For dead-code work, trace imports/re-exports, dynamic imports, worker URLs, package
exports, manifest scripts and independent/private harness callers before deletion.
An exported declaration or a module's own test is not evidence of a product caller.
Review unreachable cycles as well as files with no importers. Report generated-data
removals separately from executable code and tests; deletion counts alone are not proof
of simplification. Keep Link's unused-local/parameter compiler checks enabled and preserve
packed enum inference. Hosts consume the generic control API rather than maintaining
another property alias map, vendor switch, session cache or setter registry.

Verify README promises with built/packed exports. Run `packages/link`'s `test:package`
for strict ESM/CommonJS NodeNext consumer types, including negative input checks, with
`skipLibCheck:false`. Source-only typechecking does not establish package type safety.
Update README and docs together; do not publish fixed size/dependency counts without dated
measurement. Keep pure browser controls in `@darkgrade/link/controls`; importing the main
camera entry is not a generic browser integration. Library construction must not take over
the embedding application's console or process exception handlers by default.
Opt-in terminal logging must preserve nonzero exits for uncaught errors and unhandled
promise rejections; verify this in isolated Node consumers, not by swallowing a failure.

Keep the requested task on one branch and one PR. Historical PR numbers in technical
notes are evidence, not instructions to append new work to an old branch or to merge.

# Package boundaries

New Darkgrade product code belongs in `packages/link`, `apps/studio`, or `packages/cli`.
Link owns camera drivers, shared runtimes, diagnostics/contributions, schemas and reusable
services; Studio owns desktop UI/integrations; CLI owns command-line entry points.
Command parsing, settings actions, diagnostics and benchmark orchestration belong in
`packages/link/src/cli`, exposed as `@darkgrade/link/cli`. Keep `packages/cli` as the thin
`darkgrade` executable and its packaging, documentation and terminal smoke checks.
Do not add command behavior to that wrapper or create another CLI/runtime package.
Use modules and explicit exports within these locations, not additional workspace packages
or apps. Do not create `packages/contribute`, `packages/runtime`, or another shared package.
Existing infrastructure, sites and shared build/UI tooling may be maintained in place.
Only an explicit user request can change these boundaries. Link's possible rename is pending;
keep its current directory and package name. Test harnesses consume these modules and keep
independent fixtures; they must not introduce production packages in the Darkgrade repo.
Read these rules regardless of the agent harness (Codex, Claude, Gemini or another agent).

Physical CI powers on an off mapped supply and attempts one guarded startup recovery for
absent or unresponsive cameras before candidate tests. Fresh verified USB absence or
PTP unresponsiveness after completed recovery may produce an explicit preparation skip.
Keep scoped recovery/availability receipts and report skipped cameras separately from passes.
Failures after candidate testing starts, unknown state, lost ownership and uncertain cleanup
remain failures; an all-skipped run cannot pass. Preserve prior failed runs when the harness
or operator policy changes.

Diagnostics live in `packages/link/src/contribute` and are exported as
`@darkgrade/link/contribute` and `/contribute/{application,batch,node,protocol,schema,settings,installation-store}`.
Use `@contribute/*` for imports inside Link. Node settings stay separate from browser clients.
The Node diagnostics tests live in `packages/link/tests/contribute` and run in Link's full
test suite or with `bun run --cwd packages/link test:contribute`.

The shared camera runtime (operation ordering, leases, the common MCP tools) lives in
`packages/link/src/runtime` and is imported as `@darkgrade/link/runtime` (`/browser`, `/mcp`,
`/ownership`). There is no `packages/runtime`: put new camera code in Link. Its tests run under
Bun (`bun run --cwd packages/link test:runtime`, which builds first) because they check package
resolution with Bun's bundler; Vitest excludes `tests/runtime`. Hosts that load it by path
(Test Bench) use `packages/link/src/runtime/index.ts` and `mcp.ts`.
DeviceInfo carries numeric lists as `operationsSupportedRaw`, `eventsSupportedRaw` and
`devicePropertiesSupported`; there is no `operationsSupported` or `devicePropertiesSupportedRaw`.
Two recoveries read fields that do not exist and their tests faked them. Build test replies with
the real codec.

Telemetry scale and identity (2026-11-13): the collector keeps `telemetry_sessions` and
`telemetry_session_signals` current with statement triggers on `telemetry_events`; the overview,
session list, filters and suggestions read those and never scan raw events. Deletions decrement
counts at once and mark the session stale; maintenance refreshes time bounds and label sets.
A one-time startup rebuild (marker `sessions-v1` in `telemetry_rollup_state`) holds a brief table
lock. Any new writer of `telemetry_events` is covered by the triggers; a change to how a signal
or error is derived must change the trigger functions, the queries and the marker together.
Events recorded before a connection's identity read adopt the single identity the same session
read later (derived columns only; signed payloads stay as uploaded). Native Sony sessions read
standard DeviceInfo once per connection after authentication; a refusal is logged and ignored.
The in-session read was confirmed physically on the a6700 and FX2 (2026-11-14): it follows
authentication and precedes the first property read. Link remembers which inventory and setting
facts this installation already shared in `reported-facts.json` under the settings directory
(short hashes only), because bench camera work runs in short-lived workers; a fact is shared
again when it changes or after six hours. Probe and vendor-session scopes are kept separately.
Benchmark profiles are exempt and stay complete. Each kind of fact has its own memory entry
(vendor scope, operation and field set): a Canon setting's value and its allowed values, or two
operations listing one inventory category, must not replace each other.
The unknown-code queue reads `telemetry_unknown_codes` (per installation, kept by the same
triggers, marker `unknown-codes-v1`); session, body and signal scopes still read events.
Collector rules learned the hard way on 2026-11-14:
- Startup must not queue table locks. DDL on `telemetry_events` and the summary tables
  (including `CREATE INDEX IF NOT EXISTS`, `ALTER ... IF NOT EXISTS`, `CREATE TRIGGER`) runs only
  until those objects exist (`eventsSchemaReady`, `summarySchemaReady` in postgres.ts). A schema
  change to those tables must update the readiness check, or it will never be applied.
- Maintenance works in short transactions. One long transaction blocks the next start, and a
  backend keeps running after its collector instance is gone; only a database restart ended it.
- Triggers must stay cheap for bulk deletes: never search events from inside them. A summary row
  that needs a new source is listed in `telemetry_unknown_code_repairs` and repaired by
  maintenance within a time budget; it is hidden from the queue until then.
- `purge-unidentified-2026-11-14` removed 65,947 old events with no camera identity and 164
  uploads left empty. It is marker-guarded and dated; unidentified events after the cutoff stay.
Sony originals over 4 GiB (2026-11-14): ObjectInfo reports 0xffffffff. Support is read from
DeviceInfo `operationsSupportedRaw` (there is no `operationsSupported` field; a test that fakes
one proves nothing). The bench FX2 advertises GetObjectPropDesc but answers 0x2005; its size
comes from GetObjectPropList for the exact handle and ObjectSize, typed UINT64. A 5,101,088,166
byte FX2 original was sized, transferred, collected and fully decoded. The a6700 splits at 4 GB.
EOS R6 Mark III with its lever at Movie cannot be put in still mode over PTP: Canon's SDK
reference (6.9.5) requires the hardware in still position, and on firmware 1.0.1 every tried
route left FixedMovie at 1 (MovieSelectSwitchOff, writing 0xd1c2, remote modes 0x11/0x15, AE
mode writes under dial override). Do not spend more bench time on it without new information.
A connection that fails before any identity read (body asleep or off) is attributed to the
camera that last reported itself at the requested USB identity, from `known-cameras.json` in the
settings directory: manufacturer and model only, firmware `unknown`, and a body fingerprint only
when one exact serial was requested. A body never seen stays Unknown. Sony Wi-Fi attempts carry
the model the caller named; the trust (`fingerprint`) step shares the following connect's session.
Collector purge markers `purge-unidentified-2026-11-14` and `-14b` are one-time and dated.
Focus refusals say what the body reported: a Sony focus timeout includes the last focus status
and a Canon refusal names the SDK reason. Sony bodies in movie mode stayed at UNLOCK on a
half-press in bench tests, so focus confirmation was never obtained there.

Canon sessions send advertised KeepDeviceOn automatically every ten seconds through the
existing serialized event loop. Camera({keepAlive:false}) disables this session heartbeat;
no saved body power setting is rewritten. Explicit KeepDeviceOn rejects non-OK responses.
Nikon USB reference Z5_2UsbMtpE_01 §2.2 says PC connection disables meter auto-off already.
Its §11.7.5 documents one release command to clear a recoverable WarningStatus bit-0
sequence error. Link retries live-view startup once only after that exact warning,
idle movie/buffer state, advertised operations and fresh clearing readback. Other
hardware errors remain errors. SDK documents stay private; attribution in the workspace
camera-keepalive-2026-11-13 report must remain. Physical user actions can race warning
reads; recovery may release a shutter if someone clears the warning first.

Recording diagnostics retain bounded observed-cache snapshots around preparation, start/stop,
failure and cleanup. Each setting keeps its numeric PTP value and observation age. Acknowledged
writes never update this cache; reconnect/disconnect clear it. Snapshotting adds no USB reads,
waits or cloud calls. Canon FixedMovie is allowlisted as a numeric readback using the supplied
EDSDK/libgphoto2 references; SDK and PTP property IDs are different. Deploy collector and Matrix
schema support before candidate Link clients upload snapshots. Missing settings stay unknown;
no snapshot implies that recording or independent media validation passed.

Canon movie workflows prepare a camera-advertised card destination before movie selection,
restoring prior host routing after safe cleanup. This follows the Canon EDSDK sample and
libgphoto2 card-target enumeration; it is not proof of the R8 Mark II failure's root cause.
Numeric Canon property-write telemetry retains intent, transaction and response separately
from observed state. Deploy the matching collector and Matrix contract before rolling out
this Link candidate. Preserve real versus simulated evidence.

Telemetry benchmark now exports a deep sanitized camera profile through Link's existing
camera session. Keep inventories and allowlisted numeric descriptors separate from media,
opaque payloads and private settings. Partial/cancelled exports retain evidence without
claiming unsupported features. The CLI saves profiles even with sharing off; Test Bench
supplies leases and exposes the Darkgrade `camera_benchmark` tool. Collector research
findings require exact source, model, firmware, revision, transport and evidence scope,
plus attributed references; they expire/withdraw with the source and never certify hardware.
Shared admission quotas must remain consistent across collector instances.

Matrix imports all validated batches as diagnostic evidence automatically, with optional human review separately labeled. Committed ingestion watermarks prevent live uploads starving pagination; review, withdrawal and credit changes invalidate exports. Camera fingerprints are absent when reliable serial identity is unavailable, and reconnect must clear stale body identity.

Telemetry autocomplete uses bounded authenticated database suggestions scoped by other filters,
including old sessions. Preserve hardware/synthetic provenance and hide credentials/contact details.
Inspection modals keep summaries readable and raw evidence collapsed; test keyboard selection, stale
responses, Escape/focus return, friendly installation labels, and narrow screens.

# Project Cheat Sheet

## Tech Stack:

- TypeScript only (never JS)
- Bun/bunx for runtime, tsx for execution
- Vite for serving, Vitest for testing
- React for UIs

## Code Organization:

- Vendor code goes in src/vendors/ only
- No vendor logic in core/transport layers
- Keep package.json scripts clean and complete
- Always use import aliases ("@core/ptp-protocol/<>"), never use relative (from "../../<>") imports

## Development Process:

- Use available tools (notes, memory, MCP)
- Build real solutions, no mocks/stubs
- Only create notes after confirming features work
- Stay honest about what's actually working
- If a script or test that is close to what we need already exists modify, don't create more crap

## Commands:

- Everything runnable via npm scripts
- Easy setup and execution

## Brand and site changes

`apps/darkgrade.com` is the source of truth for the brand. Nothing syncs it to the places that
copy it, so a change to the look, the wordmark, the type or the social images is not finished
until every row below is updated in the same batch. Check this list on any rebrand, any change
to the type or colour tokens, and any re-render of the social images.

The look today: Public Sans for headings and running text, Fragment Mono for labels and readings;
`--heading-weight: 600`, `--lockup-weight: 500` (the name beside the mark is one weight lighter
than a heading); gold `#f5cd8a`, obsidian `#0A0A0B`, bone `#EAE6DC`, one red `#e0483e`; `--gI`
is the single knob for every gold glow.

| Where | Holds | Note |
| --- | --- | --- |
| `apps/darkgrade.com/public` | the ten brand files | source of truth |
| `apps/darkgrade.com/app/press-kit` | draws every social image live | regenerate here, never hand-edit a PNG |
| `apps/darkgrade.com/scripts/make-lockups.ts` | the wordmark in every ink | `bun run lockups`; writes into all three folders at once |
| `apps/drkgrd.co/public` | copies of the brand files | its card is drawn by `app/opengraph-image.tsx`, not committed |
| `apps/docs/assets` | copies, plus `ks_*` for kevinschaich.com | `docs.json` carries `fonts` and `colors` of its own |
| `toolbench`, `voicebench`, `cambench` (separate repos) | `scripts/prerender.ts` | draws a card per route with satori, from the shared component |
| `kevinschaich.com` (separate repo) | `ks_*` cards, `public/kit/v1/brand.css` | its home page mirrors drkgrd.co; a projects page besides |

The social images are rendered by `/press-kit`, which draws the home page's own scene: open it,
pick the size, download the PNG. A card that was edited by hand will drift from the site the next
time the scene changes.

One card is shared with kevinschaich.com: `@kevinschaich/components/og` exports `OgCard`, both
brand marks as bare SVGs and the backdrop, and a consumer draws its own cards from them rather
than committing a PNG. It takes a background, a logo (the mark beside a name — `Darkgrade` here,
`Kevinschaich` on Kevin's own properties), a main line, a sub line and an address. Register the
faces satori asks for under the names it expects: `body` (Public Sans 400), `heading` (Public
Sans 600 and 500) and `mono` (Fragment Mono 400). darkgrade.com's own card is the exception — it
is the camera from the home page's scene, which satori cannot draw, so it stays a render from
`/press-kit`.

The benches are the exception to the exception, and not a card each: every one of them draws a card per route in
`scripts/prerender.ts` with satori, hundreds in a build, so there is nothing to hand over. What
changes there is the template — its colours, its weights and its type — and the next build
regenerates every card from it. The same goes for anything else that generates cards
programmatically, kevinschaich.com's `opengraph-image.tsx` among them: change the template, not
the output.

A change that lands in another repository is a pull request there, not a file copied across.
Say in the darkgrade pull request which other repositories still need the same change, so the
batch can be finished rather than half-applied.

## Metrics

Everything we publish reports to the one PostHog project, through our own proxy at
`ph.darkgrade.com` — never to a PostHog host directly, and never to a project of its own. That
covers darkgrade.com, drkgrd.co, the docs, the three benches, kevinschaich.com, and every project
linked from `kevinschaich.com/projects` that we host.

A Next app reads `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` from the environment in
`instrumentation-client`, with `defaults: '2025-11-30'`, autocapture on, and session recording,
surveys and dead clicks off. Copy `apps/darkgrade.com/instrumentation-client.js` rather than
writing another one. The values themselves live in Vercel, so a new property is not reporting
until they are set there — adding the file is only half of it.

A static page carries the same project key and `https://ph.darkgrade.com` inline, since it has no
build to read an environment from. The key is a public write-only `phc_` key; it is already in
`apps/docs/docs.json` and in shipped JavaScript, so committing it again is fine. Never put a
personal or project *API* key (`phx_`) in a client.

## Physical Testbench

This checkout uses the project-scoped `darkgrade_testbench` MCP server from `.codex/config.toml`.
Before touching a camera, call `bench_status`, start a leased job with `agent_job_start`, and keep
the job alive with `agent_job_heartbeat`. A camera is healthy only when `camera_probe` completes a
PTP `GetDeviceInfo`; USB enumeration alone is insufficient.

If a transaction times out or the camera remains busy, call `camera_recover` with `strategy=auto`.
It verifies the baseline, emulates a genuine USB unplug/replug on both hub halves, re-runs this
checkout's `packages/link/tests/bench-probe.ts`, and escalates to the camera's mapped Shelly power
feed only if necessary. Always call `agent_job_finish`, including on failure, so the dashboard and
blink(1) return to the correct state.

Run the same bounded health probe directly with:

```sh
bun run --cwd packages/link bench:probe -- --camera 04a9:32f5
```

# Software Engineering Principles for Agents

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

Keep follow-up work in its requested ongoing branch/PR until the user requests a merge.
Do not create a separate PR per small follow-up fix.

Run `bun run --cwd packages/link test:fuzz` for reproducible PTP input mutation checks.
The fixed seed `0x4d415452` covers standard/Sony descriptors and Canon/Nikon event records,
including truncated views into larger buffers, invalid offsets and string length boundaries.
These synthetic parser checks neither contact hardware nor certify model support. Matrix keeps
independent copies of the wire seeds in its fixed candidate harness so driver changes cannot
silently weaken their own regression gate.

## Shared telemetry — November 12, 2026

The ingestion audit adds early bounded SDK flushes, email login/logout, paged session lists,
an operator review queue and generation-consistent Matrix exports. Reviewed evidence expires
with its original diagnostic. Test with real Postgres and a separate growth-test database:
reviewing or withdrawing during an export deliberately invalidates its cursor.
Terraform now includes encrypted-only SQL connections, server-side deletion protection and
minimal health/CPU/disk monitoring. Notification delivery requires verified channel IDs;
email requires a configured sender. Do not claim live email delivery from a mock sender test.

The ingestion implementation replaced project 18 with one HTTPS service and Postgres.
`apps/contribution-collector/src/postgres.ts`
stores flat telemetry_events plus operational state; main.ts performs its own cleanup and
serves an operator-authenticated /internal timeline. Firestore/GCS/grant collector deployment
code and the separate cleanup job were removed. Terraform provisions Cloud Run + Cloud SQL
with restricted configuration secrets; validation is not a live deployment.

The Outpost Telemetry app uses `/internal/api` for bounded issues/session reports,
installation lookup, batch review, full Matrix exports and authenticated revocation.
Never expose credential hashes/contact details. Operator mutations require JSON, the
operator header, no browser Origin and an exact ID confirmation for deletion. Keep
deletion shared with the installation API so pending cleanup and revocation stay consistent.
`bootstrap_principal` in Terraform grants scoped actAs on the collector service account;
it does not grant organization or billing-account access.

Link instruments existing USB/PTP-IP sessions, with Unknown identity until GetDeviceInfo. Custom
transports need explicit telemetry configuration, and loopback IP defaults to synthetic.
Do not mistake a real socket for proof of physical hardware. Sony SDK bridge calls have separate named-operation telemetry; no SDK arguments or payloads
are collected. USB SDK model/firmware remain Unknown when the bridge cannot supply them. Model/firmware/revision/transport,
source hashes and contributor attribution stay attached; metadata never becomes a hardware
pass. All validated Matrix diagnostic snapshots replace fully and expire within 24 hours.

Direct-source bench execution resolves revision/dirty state from the Link source checkout when
build constants are absent. Normal Node/Bun process exit attempts a bounded final flush; forced
exit preserves buffered local metadata but cannot promise cloud delivery. Keep these lifecycle
checks alongside transport attribution tests.

Node applications and packages/cli share packages/link/src/contribute/settings: one random installation
ID and scoped secret in ~/.darkgrade/settings.json, mode 0600. Installation identity stays random; camera-body fingerprints are separate versioned hashes of manufacturer/model/serial. Never retain the raw serial in telemetry. Default sharing is enabled; there is no first-run notice in CLI/Studio and no UI
retention-age blurb. The built-in hosted collector is used when no endpoint override is supplied. Opt-out stops
cloud uploads but keeps bounded sanitized local logs. Delete disables sharing first and
preserves retry state. Respect environment overrides and saved/corrupt preferences. Native
Studio migrates the earlier encrypted preference before initializing the shared file.

Run SDK, real Postgres collector, CLI, Studio and Link tests; validate Terraform and the
actual HTTP container. Test the event listener before/after observer replacement: telemetry
must not steal a camera's event handler. Run the Matrix export/import contract without
promoting metadata or mutating the installed Matrix app. No hardware operations are needed
for ordinary telemetry validation. Keep unrelated dependency symlinks intact.

**Core Philosophy**: Prioritize readability and maintainability over premature optimization. Code is written for humans to understand.

## 1. Composition Over Inheritance

- Use dependency injection and interfaces instead of class hierarchies
- Replace abstract base classes with interfaces
- Move shared functionality to separate, composable classes
- Design for change - avoid tight coupling that breaks when requirements evolve

## 2. Abstraction

- Only abstract when value exceeds coupling cost
- Wait for 3+ similar implementations before abstracting
- Don't abstract single duplicate lines or simple variable assignments
- Use lightweight interfaces over heavyweight parent classes

## 3. Naming

- Never abbreviate - write full words
- Never use single letters (except short loop counters)
- Include units in variable names (`delaySeconds`)
- Avoid "Helper", "Utils", "Base", "Abstract" in class names
- If struggling to name something, restructure the code

## 4. Code Structure

- Maximum 3 levels of indentation per function
- Use early returns and guard clauses instead of deep nesting
- Extract complex logic into well-named functions
- One responsibility per function

## 5. Comments

- Replace comments with better code whenever possible
- Use meaningful variable names instead of explaining unclear code
- Only comment for: performance reasons, mathematical algorithms, API documentation
- Write API documentation, not implementation comments

## 6. Performance

- Measure before optimizing
- Focus on data structure selection over micro-optimizations
- Solve the real problem first, optimize later
- Avoid debates about `++i` vs `i++` unless proven critical
- Use profilers to identify actual bottlenecks

## 7. Dependency Injection

- Pass dependencies instead of creating them directly
- Use interfaces to define contracts
- Enables configurable, testable systems
- Inject mocks and fakes for isolated testing

## Decision Framework

When evaluating code changes, ask:

1. Does this make the code more readable?
2. Does this reduce coupling?
3. Does this make testing easier?
4. Is this solving a real problem or theoretical one?

## Red Flags

- Deep inheritance hierarchies
- Utility classes with mixed responsibilities
- Premature performance optimizations
- Comments explaining complex code
- Excessive nesting
- Abbreviations

## Priority Order

1. Solve the business problem correctly
2. Make code readable and maintainable
3. Ensure code is testable
4. Optimize only when measured as necessary
