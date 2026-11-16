# Darkgrade CLI

After publication: `npx darkgrade telemetry …`. This workspace has not published the package.
For local development, build Link/contribute/CLI and run `node packages/cli/dist/main.js`.

- `whoami`: print the persistent random diagnostic ID, never its secret.
- `status`: show the sharing preference and endpoint configuration.
- `opt-out`: stop future cloud uploads; retain bounded sanitized local diagnostics.
- `opt-in`: enable sharing again. After deletion this starts a new cloud identity.
- `delete`: disable sharing and delete cloud data; failed deletion remains retryable.
- `benchmark --camera VID:PID`: read camera identity, storage and properties.
- Add `--capture` to take/transfer a photo, or `--live` to request a live frame.
  Capture can write a file on the camera. No format/delete/reset/power operation is included.

Benchmarks use Link's existing drivers and bounded transaction deadlines, report each
selected check separately, and always attempt disconnect. A returned media payload proves
a transfer, not independent image decoding or complete model qualification. The initial
benchmark does not test every vendor setting or automatically change exposure settings.
It respects opt-out and never uploads previously retained local logs. On managed test
benches, use the bench/runtime ownership mechanism before opening a camera; do not run a
second direct session over an existing owner.

CLI and Studio share `~/.darkgrade/settings.json`. Set `DARKGRADE_TELEMETRY_URL` to the
collector origin. No required notice or email flow exists. Studio Preferences provides
sharing, Copy diagnostic ID, Delete cloud data and the same read-only Check camera run.
The explicit capture/live CLI options remain camera operations, not background telemetry.
