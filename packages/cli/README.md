# Darkgrade CLI

Alpha releases: `npx darkgrade@alpha telemetry …`.
For local development, build Slate and CLI and run `node packages/cli/dist/main.js`.

This package is a thin executable wrapper. Command parsing, preference actions and camera
benchmark orchestration live in Slate and are also available to Node consumers through
`runDarkgradeCli` from `@darkgrade/slate/cli`. The published executable bundles that runner,
preserving standalone `npx darkgrade` installation.

- `whoami`: print the persistent random diagnostic ID, never its secret.
- `status`: show the sharing preference and endpoint configuration without contacting the service.
- `login EMAIL`: request a Resend confirmation link to identify your telemetry contributions.
  Open the link within 15 minutes; it can be used once. No mailing-list signup is included.
- `status --email`: read the confirmed email association from the collector, or `contact: null`
  while no email is confirmed. This is an explicit network request.
- `logout`: remove the email association without changing the sharing preference.
- `opt-out`: stop future cloud uploads; retain bounded sanitized local diagnostics.
- `opt-in`: enable sharing again. After deletion this starts a new cloud identity.
- `delete`: disable sharing and delete cloud data; failed deletion remains retryable.
- `benchmark --camera VID:PID`: read camera identity, storage and properties.
- Add `--capture` to take/transfer a photo, or `--live` to request a live frame.
  Capture can write a file on the camera. No format/delete/reset/power operation is included.

Benchmarks use Slate's existing drivers and bounded transaction deadlines, report each
selected check separately, and always attempt disconnect. A returned media payload proves
a transfer, not independent image decoding or complete model qualification. The initial
benchmark does not test every vendor setting or automatically change exposure settings.
It respects opt-out and never uploads previously retained local logs. On managed test
benches, use the bench/runtime ownership mechanism before opening a camera; do not run a
second direct session over an existing owner.

CLI and Studio share `~/.darkgrade/settings.json`. Set `DARKGRADE_TELEMETRY_URL` to the
collector origin. Email linking is optional and requires sharing to be enabled when requested;
logout still works after opting out. Studio Preferences provides
sharing, Copy diagnostic ID, Delete cloud data and the same read-only Check camera run.
The explicit capture/live CLI options remain camera operations, not background telemetry.
