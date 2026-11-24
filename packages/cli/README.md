# Darkgrade CLI

`npx darkgrade telemetry …`. Every change to the CLI or Slate on `main` publishes a new build,
and both the `latest` and `alpha` tags point at it.
For local development, build Slate and CLI and run `node packages/cli/dist/main.js`.

This package is a thin executable wrapper. Command parsing, preference actions and camera
benchmark orchestration live in Slate and are also available to Node consumers through
`runDarkgradeCli` from `@darkgrade/slate/cli`. The published executable bundles that runner,
preserving standalone `npx darkgrade` installation.

- `whoami`: print the persistent random diagnostic ID, never its secret.
- `status`: show the sharing preference and endpoint configuration without contacting the service.
- `login EMAIL`: request a Resend confirmation link to identify your telemetry contributions.
  Open the link within 2 hours; it can be used once. No mailing-list signup is included.
- `status --email`: read the confirmed email association from the collector, or `contact: null`
  while no email is submitted. Submitted addresses show `verified: false`; a pending replacement
  is returned as `pendingEmail` while the previous verified address stays current. This is an explicit network request.
- `logout`: remove the email association without changing the sharing preference.
- `opt-out`: stop future cloud uploads; retain bounded sanitized local diagnostics.
- `opt-in`: enable sharing again. After deletion this starts a new cloud identity.
- `delete`: disable sharing and delete cloud data; failed deletion remains retryable.
- `benchmark`: find the attached camera and run the full benchmark: identity, storage, every
  readable property, one photo capture/transfer and one live-view frame. Then it prints a short
  summary (model, firmware, properties read, capture/live result, saved profile, upload).
  Capture can write a file on the camera. No format/delete/reset/power operation is included.
  - No camera found: it explains how to connect (Sony USB mode "PC Remote", Fujifilm
    "USB Tether Shooting", not card-reader/mass-storage modes) and exits 1.
  - Several cameras: it uses the only camera-maker device, otherwise lists them; choose one with
    `--camera VID:PID`.
  - `--no-capture` / `--no-live` skip the photo or live frame; `--json` prints the full result.
    `--capture` and `--live` are still accepted and change nothing.

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

Submitting a different address is allowed immediately (up to five confirmations a day).
Verifying the latest address reassigns the installation's entire retained history; previous
links cannot undo it. Private support lookup is in Outpost **Telemetry → Contributors**.
See `packages/slate/docs/telemetry-email-enrollment.md` in the source repository for a test walkthrough.
