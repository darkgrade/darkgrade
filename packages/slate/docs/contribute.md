# Slate diagnostics (`@darkgrade/slate/contribute`)

The shared diagnostics queue behind Darkgrade Slate, CLI and native Studio. On first use,
sharing defaults on. There is no required first-run notice or prompt. Imports and npm
installation do not open cameras, write settings or contact a collector.

What Darkgrade collects, why, which services receive it and the controls people have are
stated only in the [privacy policy](https://darkgrade.com/privacy). This document covers how the module works.

On Node, `nodeDiagnostics()` from `@darkgrade/slate/contribute/settings` owns one queue across
cameras. Slate's ordinary USB/PTP-IP camera path attaches it to the existing connection
before connection, then replaces Unknown model/firmware with the GetDeviceInfo result. It does not create a
second camera session. Custom transports need explicit configuration; loopback PTP/IP
is treated as simulated. Sony's Node SDK bridge records named SDK calls separately.
Its selected Wi-Fi model comes from the successful SDK connection profile; USB model and
firmware remain Unknown unless an authoritative identity is available. Custom/native
backends outside these Slate paths need explicit instrumentation.

The random installation ID and secret are generated once in `~/.darkgrade/settings.json`
(mode 0600), shared by CLI and Studio. `DARKGRADE_HOME`
changes this directory. File updates are atomic and serialized; stale enrollment writes
cannot overwrite another process's opt-out. Corrupt state fails closed. A lock left by a
crashed process must be investigated before removing it; initialization never steals a lock.

Node clients use the hosted collector by default; `DARKGRADE_TELEMETRY_URL` overrides
the HTTPS origin. `DARKGRADE_CONTRIBUTIONS=0` or `DO_NOT_TRACK=1` overrides cloud
sharing. Saved opt-outs survive updates and Studio migrates its earlier encrypted state.

`createApplicationDiagnostics` from `@darkgrade/slate/contribute/application` is the portable
entry point for custom/browser hosts. Supply an endpoint and persistent store. Optional
`presentNotice` is an embedding-product hook, not a requirement. `observe(transport,
context)` retains the same connection. `configureSlateTelemetry(client)` installs that
client for Slate's camera path without importing Node settings in the browser.

Batches flush every 30 seconds, with a bounded queue, deadlines, backoff and idempotent
retry. An active process checks shared preferences before upload.

Decoded protocol evidence is validated by `@darkgrade/slate/contribute/protocol`; numeric
values must fit the declared PTP type.

`darkgrade telemetry benchmark` finds the attached USB PTP camera and reads a deep camera
profile through the existing Slate camera implementation. With several cameras attached it
uses the only camera-maker device or lists them for `--camera VVVV:PPPP`. It exports
`~/.darkgrade/profiles/<uuid>.json` with restrictive permissions even when sharing is off and
prints a short summary (`--json` prints the full result). Progress is printed to stderr;
Ctrl-C requests cancellation between bounded operations. The profile reports complete,
partial or cancelled and retains the exact revision, transport and evidence type. Photo
capture and a live-view frame run by default (`--no-capture`/`--no-live` skip them).
Bodies without a vendor inventory (e.g. Fujifilm) have every
advertised property descriptor read, vendor codes included. A completed inventory is not proof that every advertised feature works.

First contact: on Node, when a body outside `validatedCameraModels`
(`src/camera/validated-models.ts`) connects, `Camera.connect()` runs the same inventory once per
model+firmware per installation in read-only mode (identity, property descriptors, storage IDs;
no capture, live view or Sony transfer-mode switch). Its benchmark evidence carries
`purpose: 'first-contact'`. It never runs with sharing off, under `NODE_ENV=test`, or on
simulated transports; `new Camera({ firstContact: false })` disables it.

`setConsent(false)` stops cloud uploads and clears the upload queue. Diagnostics
continue locally in `~/.darkgrade/diagnostics` for debugging. Each process rotates at 2 MiB,
keeps one previous file, and prunes old inactive process files on startup. Set
`DARKGRADE_LOCAL_DIAGNOSTICS=0` to disable local logging. Local files are not automatically
backfilled when sharing is re-enabled. `withdraw()` disables sharing, revokes the credential
and deletes cloud data; interrupted deletion stays pending and can be retried. A subsequent
explicit opt-in after deletion creates a new cloud identity.

Only IDs/status are exposed to Studio's renderer. The local secret authorizes this
installation's upload/deletion. Email linking is optional:

```sh
darkgrade telemetry login you@example.com
# Open the confirmation link in the email, then:
darkgrade telemetry status --email
darkgrade telemetry logout
```

Resend sends the confirmation from the collector's configured verified sender. The key stays
on the server. Links expire after 2 hours and can be used once. `status --email` explicitly
reads the current submitted/verified association and any pending replacement; ordinary `status` remains offline.
Login requires sharing to be enabled; logout remains available after opting out and does not
change that preference. Installation withdrawal also removes the association. Hosts can use
the existing `requestContact`, `contactStatus` and `removeContact` methods for the same flow.
Full encrypted transport recordings are separate.

Private **Telemetry → Contributors** joins submitted addresses to the installation's retained
camera/session history, including earlier sessions. Unverified addresses are marked as claims.
An existing verified address stays current until its replacement is verified; then the same
installation's retained history is reassociated. [Test enrollment](telemetry-email-enrollment.md).

The `@darkgrade/slate/contribute` entry retains the previous single-camera observer API. New
integrations should use the shared application/settings entry points. The old signed-grant
collector is not part of the current deployment.

Recording state snapshots contain at most 32 reviewed numeric settings from Slate's existing
readback cache. Each value includes its observation age and workflow phase. Requested writes
are separate evidence and cannot update observed state. Missing or old values remain explicit;
snapshotting performs no camera reads, sleeps or synchronous uploads. Canon FixedMovie uses
PTP property `0xd1c2` (libgphoto2 `ptp.h` / `config.c`, `eosmovieswitch`); Canon EDSDK
13.20.21 names the same feature `kEdsPropID_FixedMovie` with a different SDK identifier.
