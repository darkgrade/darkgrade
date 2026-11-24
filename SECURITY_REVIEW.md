# Test Bench migration and security review

This review covers the current Darkgrade source tree and the browser UI material selected for migration. It is a source and dependency audit, not a certification of camera firmware or every possible vulnerability.

## Migration checklist

- [x] Check the allowlisted UI sources before copying them into Darkgrade.
- [x] Exclude personal names, email addresses, private network addresses and vendor PDFs from the migrated material.
- [x] Import a source snapshot without the Test Bench repository's commit history.
- [x] Confirm squash-and-merge is acceptable for Test Bench UI PRs.

The migrated snapshot contains layout styles and two pure browser console components. `apps/testbench/MIGRATION.json` records their source revision and hashes. No fleet hardware controller, deployment configuration, camera identities, captured media, vendor documents or credentials were imported. System fonts replace binary assets. Source content was reviewed for personal names as well as checked for credential and address patterns before copying. A new local USB host uses Slate's generic Camera interface.

Both repositories have squash merging enabled. Use squash-and-merge for reviewed Test Bench UI snapshots and follow-up PRs; importing the hardware repository's history is outside this migration.

## Local bench boundary

Run `bun run testbench` to connect your own USB cameras. The browser talks only to the localhost host, which serializes camera actions through Slate's shared runtime queue. Optional simulation is explicitly labelled and performs no camera operations.

The host checks the exact local Host, same-origin requests, a required API header and an ephemeral bearer token. USB serials stay out of the browser and media transfers remain local. Slate's shared diagnostics follow the operator's existing opt-in. Its CSP permits only same-origin connections and local/blob preview images, and denies frames and embedded media. Browser device permissions are disabled; native USB access belongs to the host. Static file serving is restricted to the built UI.

CI tests the local host, actual HTTP boundary and browser UI with explicit fixtures, plus the optional simulator. Negative tests cover uncertain recording starts, shutdown during pending connection, duplicate USB identities, failed setting readback, unsupported controls, HTML injection and cross-origin requests. Browser sources cannot import native transports; the reviewed same-origin API client is the sole fetch entry point. Physical runs remain a separate qualification step.

## Existing code and dependencies

Studio now sandboxes its renderer windows, prevents navigation to other documents, restricts OS-opened links to credential-free HTTP(S), and validates the sending frame before handling privileged IPC. Its preload is bundled as CommonJS for the sandbox. Packaged builds ignore development renderer URL overrides.

Vulnerable dependencies and affected tooling were upgraded, including Electron, MCP, Vitest, SvelteKit and transitive packages. The dependency audit reports no known advisories for the resulting lockfile. Bun 1.4.3 and Node 22.18 or newer are the supported baseline for this snapshot. Compatibility checks cover Slate, Studio, the CLI, telemetry packages and the web example.

`bun run security:check` scans tracked and newly added source files for recognizable credential formats and rejects committed environment files. It separately checks Test Bench for private addresses, email addresses, private home paths and excluded artifacts. Findings contain only file locations and categories.

No live credentials were identified in the reviewed source. Password literals reviewed in camera tests are synthetic fixtures. Legal attribution, public project information and documented example addresses elsewhere in the repository are retained.

## Continuing the checks

CI runs `security:check`, `security:test`, `bun audit` and the host/UI tests on pull requests. New migration material still requires content review, especially names and document provenance.

Pattern matching cannot prove that every secret is absent. This pass does not rewrite old Git history, inspect ignored developer environment files, scan external storage, or replace an independent penetration test. If a real credential is discovered, revoke or rotate it first and then decide how to remove its historical copies.
