# Audit before adding code

Before adding a primitive, command, property map, parser, retry loop, package or helper,
search its canonical name, aliases and existing consumers. State in the PR which existing
implementation was reused and why a new abstraction is necessary. Consolidate an existing
primitive and its callers together; do not add a parallel implementation for a new harness.
Use the workflow in `.claude/commands/untangle-codebase.md` regardless of agent harness.
Read `packages/slate/docs/pre-release-audit.md` for the measured audit and decisions.

Before naming another setting, search `cameraControlDefinitions`, `resolveCameraControl`,
the vendor property preferences, protocol definitions and the hosts that consume them.
`shutterSpeed` is the sole application id; exposure time and shutter angle are search aliases.
Aliases share semantics, retain native units and require actual frame rate for conversion.
Keep wire operation/property/event names and vendor namespaces intact; equal numeric codes
across vendors do not establish equivalent operations. An alias cannot create implementation
support, writable choices or hardware qualification.

On an API/name change, update the root README, package README and getting-started docs together.
The existing `test:package` check compiles their actual TypeScript fragments from the tarball
under strict NodeNext; fragments inherit only typed Camera/filesystem context and never run
hardware. Preserve its negative type assertions, ESM/CommonJS and browser-boundary checks.
Keep static parameter/value types separate from runtime body choices and physical evidence.
Check current publication state before adding installation badges or claiming npm availability.

Application controls use `Camera.getCapabilities()` and `Camera.setControl()`. Canonical
ids/labels/search aliases are in `packages/slate/src/camera/controls.ts`; vendor property
preference is in `src/vendors/control-properties.ts`. Studio and test harnesses consume
Slate rather than adding vendor tables. `shutterSpeed` covers exposure duration and angle;
conversion requires the actual frame rate. Never guess units, switch modes implicitly,
round a requested control to the nearest enum, or treat registry presence as availability.
Preserve Bulb/Time/flash-sync, current read-only/empty/ambiguous choices, idle/session guards
and failed readbacks. Different transports must not claim parity without adapter evidence.

For dead-code work, trace imports/re-exports, dynamic imports, worker URLs, package
exports, manifest scripts and independent/private harness callers before deletion.
An exported declaration or a module's own test is not evidence of a product caller.
Review unreachable cycles as well as files with no importers. Report generated-data
removals separately from executable code and tests; deletion counts alone are not proof
of simplification. Keep Slate's unused-local/parameter compiler checks enabled and preserve
packed enum inference. Hosts consume the generic control API rather than maintaining
another property alias map, vendor switch, session cache or setter registry.

Verify README promises with built/packed exports. Run `packages/slate`'s `test:package`
for strict ESM/CommonJS NodeNext consumer types, including negative input checks, with
`skipLibCheck:false`. Source-only typechecking does not establish package type safety.
Update README and docs together; do not publish fixed size/dependency counts without dated
measurement. Keep pure browser controls in `@darkgrade/slate/controls`; importing the main
camera entry is not a generic browser integration. Library construction must not take over
the embedding application's console or process exception handlers by default.
Opt-in terminal logging must preserve nonzero exits for uncaught errors and unhandled
promise rejections; verify this in isolated Node consumers, not by swallowing a failure.

Keep the requested task on one branch and one PR. Historical PR numbers in technical
notes are evidence, not instructions to append new work to an old branch or to merge.

# Subsystem notes

Rules that apply to one part of the repository live beside it. Read the one for the area
you are changing before you start, regardless of the agent harness:

- `packages/slate/AGENTS.md`: where Slate's modules live, driver invariants, bench findings,
  private camera recordings and fuzz checks.
- `apps/contribution-collector/AGENTS.md`: telemetry, the collector, its database rules,
  contributor identity and the Matrix export.
- `packages/cli/AGENTS.md`: the thin `darkgrade` executable.

# Package boundaries

New Darkgrade product code belongs in `packages/slate`, `apps/studio`, or `packages/cli`.
Slate owns camera drivers, shared runtimes, diagnostics/contributions, schemas and reusable
services; Studio owns desktop UI/integrations; CLI owns command-line entry points.
Command parsing, settings actions, diagnostics and benchmark orchestration belong in
`packages/slate/src/cli`, exposed as `@darkgrade/slate/cli`. Keep `packages/cli` as the thin
`darkgrade` executable and its packaging, documentation and terminal smoke checks.
Do not add command behavior to that wrapper or create another CLI/runtime package.
Use modules and explicit exports within these locations, not additional workspace packages
or apps. Do not create `packages/contribute`, `packages/runtime`, or another shared package.
Existing infrastructure, sites and shared build/UI tooling may be maintained in place.
Only an explicit user request can change these boundaries. The camera library is Slate,
in `packages/slate`, named `@darkgrade/slate` (publishing is pending); do not recreate `packages/link`
or another shared camera package. Test harnesses consume these modules and keep
independent fixtures; they must not introduce production packages in the Darkgrade repo.
Read these rules regardless of the agent harness (Codex, Claude, Gemini or another agent).

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
| `apps/darkgrade.com/drkgrd.co/public` | copies of the brand files | its card is drawn by `app/opengraph-image.tsx`, not committed |
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
checkout's `packages/slate/tests/bench-probe.ts`, and escalates to the camera's mapped Shelly power
feed only if necessary. Always call `agent_job_finish`, including on failure, so the dashboard and
blink(1) return to the correct state.

Run the same bounded health probe directly with:

```sh
bun run --cwd packages/slate bench:probe -- --camera 04a9:32f5
```

Physical CI powers on an off mapped supply and attempts one guarded startup recovery for
absent or unresponsive cameras before candidate tests. Fresh verified USB absence or
PTP unresponsiveness after completed recovery may produce an explicit preparation skip.
Keep scoped recovery/availability receipts and report skipped cameras separately from passes.
Failures after candidate testing starts, unknown state, lost ownership and uncertain cleanup
remain failures; an all-skipped run cannot pass. Preserve prior failed runs when the harness
or operator policy changes.

# Software Engineering Principles for Agents

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
