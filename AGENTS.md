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
`createRecordingBundle` writes a new private directory with hashed blobs and explicit provenance;
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
`feat/private-camera-recordings`. Do not create a separate PR per small follow-up fix.

## Optional camera contributions

`packages/contribute` is a separately packaged, consent-controlled diagnostics observer.
Importing Link or the contribution package never enables collection. Consent defaults off;
`setConsent(false)` stops collection and clears buffered diagnostics, while `optOut()` also
revokes the contributor grant and requests cloud deletion. Honor environment overrides.
Full recordings and image payloads stay in the existing explicit private recording workflow.
Do not route those blobs through the metadata-only collector or automatically promote uploads.

`apps/contribution-collector` provides the scoped-token collector and validated GCP Terraform.
Use workload identity and Secret Manager; no cloud/signing credentials belong in npm clients.
Uploads remain private/unreviewed with contributor ID, optional consented credit, terms version,
source hash, firmware, dirty flag and driver revision. Retain that reference in derived artifacts.
Revocation tombstones are permanent; quota records expire after two days, diagnostics after 30.
The application still owns enrollment, notice, grant refresh and withdrawal retry UI. Cloud
project/deployment identity and an approved enrollment flow are required before customer rollout.
Keep the signing key version pinned until old grants have a supported withdrawal migration.

Build the new workspaces before tests/package checks. Run their public-seam tests plus Link's
contribution transfer test; verify package contents and Terraform without deploying credentials.
Keep all this work on `feat/private-camera-recordings` and the same PR until requested to merge.

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
