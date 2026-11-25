# Darkgrade CLI

`npx darkgrade`. Every change to the CLI or Slate on `main` publishes a new build,
and both the `latest` and `alpha` tags point at it.
For local development, build Slate and CLI and run `node packages/cli/dist/main.js`.

This package is a thin executable wrapper. Command parsing, help, completions, the manual
page, preference actions and camera benchmark orchestration live in Slate and are also
available to Node consumers through `runDarkgradeCli` from `@darkgrade/slate/cli`. The
published executable bundles that runner, preserving standalone `npx darkgrade` installation.
The wrapper passes its own version and writes `dist/darkgrade.1` at build time.

```sh
darkgrade                      # every command on one screen
darkgrade doctor               # is this computer and camera ready?
darkgrade cameras              # what is attached
darkgrade telemetry benchmark  # run every check on the attached camera
darkgrade telemetry status     # is sharing on?
```

## Finding your way

- `darkgrade`, `darkgrade --help`, `-h` and `darkgrade help` print the same help and exit 0.
  `darkgrade help <command>`, `<command> --help` and a bare group such as `darkgrade telemetry`
  print help for that command, with examples.
- `darkgrade --version`, `-V` and `darkgrade version` print `darkgrade <version>`.
  `darkgrade version --json` adds the Node version and platform.
- `darkgrade man` opens the manual page (and prints its roff source when piped). A global
  install also registers it, so `man darkgrade` works.
- `darkgrade completions bash|zsh|fish` prints a completion script for commands and flags:

  ```sh
  darkgrade completions zsh > ~/.zfunc/_darkgrade      # with ~/.zfunc on fpath
  darkgrade completions bash > ~/.local/share/bash-completion/completions/darkgrade
  darkgrade completions fish > ~/.config/fish/completions/darkgrade.fish
  ```

- A mistyped command or flag is answered with the closest one (`Unknown command "telemtry".
  Did you mean "telemetry"?`). Nothing is run on a guess.

## Output, colour, animation and questions

Results go to standard output; progress, questions, warnings and errors go to standard error.
A command that was not understood exits 1 and prints nothing on standard output.

| Flag or variable | Effect |
| --- | --- |
| `--json` (where listed) | One JSON document on standard output |
| `-q`, `--quiet` | Results only, no progress |
| `--no-color`, `NO_COLOR` | No colour. `FORCE_COLOR` keeps it when piped; `--no-color` wins over both |
| `--no-progress`, `DARKGRADE_NO_SPINNER` | No spinner; one plain line for each step |
| `--no-input` | Never ask; fail and name the missing argument |
| `CI`, `TERM=dumb` | No spinner and no questions |
| `DARKGRADE_CAMERA=VID:PID` | The camera to use when several are attached; `--camera` wins |
| `DARKGRADE_DEBUG` | Print the stack trace of a failure |

Global flags may appear anywhere before `--`. Colour, the spinner and questions are used only
on a terminal, so pipes and scripts get plain, stable output:

- The spinner shows what a slow step is doing: looking for cameras, connecting, each
  benchmark check with a running count and elapsed time, and network requests.
- `telemetry benchmark` asks which camera to use when several are attached (arrows or a
  number, Enter to choose, Esc to cancel). Without a terminal it lists them for `--camera`.
- `telemetry login` asks for the address when it is left out.
- `telemetry delete` asks for confirmation; `--yes` skips it. Without a terminal it runs
  as before, so existing scripts keep working.
- `telemetry status` prints a short table on a terminal and the same JSON as before when
  piped or with `--json`.

## Commands

- `cameras`: list each attached camera with its USB id and whether it is ready or attached
  in another USB mode. It enumerates USB only; no session is opened. Tab-separated when piped;
  `--json` for scripts.
- `doctor`: check the Node version, the settings folder, the USB driver and the attached
  cameras, and say how to fix what it finds. A missing camera is a warning (exit 0); a failed
  check exits 1. The home folder is written as `~`, so the output can be pasted into an issue.
  `--json` prints `{ version, healthy, checks }`.

The rest are under `darkgrade telemetry`. What is collected and why is in the [privacy policy](https://darkgrade.com/privacy).

- `whoami`: print the persistent random diagnostic ID, never its secret.
- `status`: show the sharing preference and endpoint configuration without contacting the service.
- `login EMAIL`: request a Resend confirmation link to identify your telemetry contributions.
  Open the link within 2 hours; it can be used once.
- `status --email`: read the confirmed email association from the collector, or `contact: null`
  while no email is submitted. Submitted addresses show `verified: false`; a pending replacement
  is returned as `pendingEmail` while the previous verified address stays current. This is an explicit network request.
- `logout`: remove the email association without changing the sharing preference.
- `opt-out`: stop future cloud uploads; local diagnostics are still written.
- `opt-in`: enable sharing again. After deletion this starts a new cloud identity.
- `delete`: disable sharing and delete cloud data; failed deletion remains retryable.
- `benchmark`: find the attached camera and run the full benchmark: identity, storage, every
  readable property, one photo capture/transfer and one live-view frame. Then it prints a short
  summary (model, firmware, properties read, capture/live result, saved profile, upload).
  Capture can write a file on the camera. No format/delete/reset/power operation is included.
  - No camera found: it explains how to connect (Sony USB mode "PC Remote", Fujifilm
    "USB Tether Shooting", not card-reader/mass-storage modes) and exits 1.
  - Several cameras: it uses the only camera-maker device; otherwise it asks on a terminal and
    lists them elsewhere. Choose one with `--camera VID:PID` or `DARKGRADE_CAMERA`.
  - `--no-capture` / `--no-live` skip the photo or live frame; `--json` prints the full result.
    `--capture` and `--live` are still accepted and change nothing.

Benchmarks use Slate's existing drivers and bounded transaction deadlines, report each
selected check separately, and always attempt disconnect. A returned media payload proves
a transfer, not independent image decoding or complete model qualification. The initial
benchmark does not test every vendor setting or automatically change exposure settings.
It respects opt-out. On managed test
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
