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

Keep this work on one ongoing branch/PR until the user requests a merge; the current batch is
`feat/runtime-browser-core`. Do not create a separate PR per small follow-up fix.

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

The user replaced project 18 with one HTTPS service and Postgres. Keep this on PR #58,
`feat/runtime-browser-core`; do not merge. `apps/contribution-collector/src/postgres.ts`
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
pass. Reviewed Matrix snapshots still replace fully and expire within 24 hours.

Direct-source bench execution resolves revision/dirty state from the Link source checkout when
build constants are absent. Normal Node/Bun process exit attempts a bounded final flush; forced
exit preserves buffered local metadata but cannot promise cloud delivery. Keep these lifecycle
checks alongside transport attribution tests.

Node applications and packages/cli share packages/contribute/settings: one random installation
ID and scoped secret in ~/.darkgrade/settings.json, mode 0600. Never derive identity from a
serial. Default sharing is enabled; there is no first-run notice in CLI/Studio and no UI
retention-age blurb. Missing endpoint prevents uploads, not local diagnostics. Opt-out stops
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
