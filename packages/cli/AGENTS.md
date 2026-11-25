# Thin executable

Read the root `AGENTS.md` first; this file only adds to it.

All command behavior belongs in `packages/slate/src/cli`, exported by `@darkgrade/slate/cli`.
This package contains only the `darkgrade` entry point, npm packaging, documentation and
executable smoke checks. Do not add command parsing, camera workflows or preference
logic here. Keep command behavior tests with Slate.

Build Slate before this wrapper. The npm executable bundles the Slate runner, so installing
`darkgrade` does not require an unpublished `@darkgrade/slate` npm dependency. Preserve
the existing command syntax, exit codes, lazy camera loading and native dependencies.

The command tree is one table, `packages/slate/src/cli/commands.ts`. Help, the manual page,
shell completions, argument checks and typo suggestions are generated from it; add a command
or flag there, never in a second list. Terminal output goes through `src/cli/terminal.ts`,
which decides colour, the spinner and whether a question may be asked. A new prompt needs a
flag that answers it, and a pipe must keep getting the output it got before.
