# Thin executable

All command behavior belongs in `packages/link/src/cli`, exported by `@darkgrade/link/cli`.
This package contains only the `darkgrade` entry point, npm packaging, documentation and
executable smoke checks. Do not add command parsing, camera workflows or preference
logic here. Keep command behavior tests with Link.

Build Link before this wrapper. The npm executable bundles the Link runner, so installing
`darkgrade` does not require an unpublished `@darkgrade/link` npm dependency. Preserve
the existing command syntax, exit codes, lazy camera loading and native dependencies.
