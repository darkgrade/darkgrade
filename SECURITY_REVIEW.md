# Test Bench migration and security review

This review covers the current Darkgrade source tree and the browser UI material selected for migration. It is a source and dependency audit, not a certification of camera firmware or every possible vulnerability.

## Migration checklist

- [x] Check the allowlisted UI sources before copying them into Darkgrade.
- [x] Exclude personal names, email addresses, private network addresses and vendor PDFs from the migrated material.
- [x] Import a source snapshot without the Test Bench repository's commit history.
- [x] Confirm squash-and-merge is acceptable for Test Bench UI PRs.

The migrated snapshot contains layout styles and two pure browser console components. `apps/testbench/MIGRATION.json` records their source revision and hashes. No hardware controller, deployment configuration, camera identities, captured media, vendor documents or credentials are included. System fonts and generated scenes replace binary assets. Source content was reviewed for personal names as well as checked for credential and address patterns before copying.

Both repositories have squash merging enabled. Use squash-and-merge for reviewed Test Bench UI snapshots and follow-up PRs; importing the hardware repository's history is outside this migration.

## Demo boundary

Run `bun run testbench` to explore the UI with simulated cameras. Checks, exposure controls, previews and takes operate only on temporary browser state. Refreshing or resetting clears it.

The demo has no runtime dependencies, camera transport, telemetry uploader or controller endpoint. Its CSP denies network connections, frames and media; permission headers disable device access. The local development server binds to localhost and restricts file access to the demo root.

CI runs the demo's state and browser tests, verifies its file-serving boundary, and rejects hardware/network capabilities in its browser sources. Negative tests cover unavailable cameras, unsupported controls, reset during a pending operation, HTML injection and blocked network requests.

## Existing code and dependencies

Studio now sandboxes its renderer windows, prevents navigation to other documents, restricts OS-opened links to credential-free HTTP(S), and validates the sending frame before handling privileged IPC. Its preload is bundled as CommonJS for the sandbox. Packaged builds ignore development renderer URL overrides.

Vulnerable dependencies and affected tooling were upgraded, including Electron, MCP, Vitest, SvelteKit and transitive packages. The dependency audit reports no known advisories for the resulting lockfile. Bun 1.4.3 and Node 22.18 or newer are the supported baseline for this snapshot. Compatibility checks cover Link, Studio, the CLI, telemetry packages and the web example.

`bun run security:check` scans tracked and newly added source files for recognizable credential formats and rejects committed environment files. It separately checks the demo for private addresses, email addresses, private home paths and non-UI artifacts. Findings contain only file locations and categories.

No live credentials were identified in the reviewed source. Password literals reviewed in camera tests are synthetic fixtures. Legal attribution, public project information and documented example addresses elsewhere in the repository are retained.

## Continuing the checks

CI runs `security:check`, `security:test`, `bun audit` and the simulated UI tests on pull requests. New migration material still requires content review, especially names and document provenance.

Pattern matching cannot prove that every secret is absent. This pass does not rewrite old Git history, inspect ignored developer environment files, scan external storage, or replace an independent penetration test. If a real credential is discovered, revoke or rotate it first and then decide how to remove its historical copies.
