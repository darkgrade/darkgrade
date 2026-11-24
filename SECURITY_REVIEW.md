# Security review

This review covers the current Darkgrade source tree. It is a source and dependency audit, not a certification of camera firmware or every possible vulnerability.

## Existing code and dependencies

Studio now sandboxes its renderer windows, prevents navigation to other documents, restricts OS-opened links to credential-free HTTP(S), and validates the sending frame before handling privileged IPC. Its preload is bundled as CommonJS for the sandbox. Packaged builds ignore development renderer URL overrides.

Vulnerable dependencies and affected tooling were upgraded, including Electron, MCP, Vitest, SvelteKit and transitive packages. The dependency audit reports no known advisories for the resulting lockfile. Bun 1.4.3 and Node 22.18 or newer are the supported baseline for this snapshot. Compatibility checks cover Slate, Studio, the CLI and telemetry packages.

`bun run security:check` scans tracked and newly added source files for recognizable credential formats and rejects committed environment files. Findings contain only file locations and categories.

No live credentials were identified in the reviewed source. Password literals reviewed in camera tests are synthetic fixtures. Legal attribution, public project information and documented example addresses elsewhere in the repository are retained.

## Continuing the checks

CI runs `security:check`, `security:test` and `bun audit` on pull requests. New material still requires content review, especially names and document provenance.

Pattern matching cannot prove that every secret is absent. This pass does not rewrite old Git history, inspect ignored developer environment files, scan external storage, or replace an independent penetration test. If a real credential is discovered, revoke or rotate it first and then decide how to remove its historical copies.
