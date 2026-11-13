# @darkgrade/contribute

The shared diagnostics queue behind Darkgrade Link, CLI and native Studio. On first use,
sharing defaults on. There is no required first-run notice or prompt. Imports and npm
installation do not open cameras, write settings or contact a collector.

On Node, `nodeDiagnostics()` from `@darkgrade/contribute/settings` owns one queue across
cameras. Link's ordinary USB/PTP-IP camera path attaches it to the existing connection
before connection, then replaces Unknown model/firmware with the GetDeviceInfo result. It does not create a
second camera session. Custom transports need explicit configuration; loopback PTP/IP
is treated as simulated. Sony's Node SDK bridge records named SDK calls separately, without arguments or payloads.
Its selected Wi-Fi model comes from the successful SDK connection profile; USB model and
firmware remain Unknown unless an authoritative identity is available. Custom/native
backends outside these Link paths need explicit instrumentation.

The random installation ID and secret are generated once in `~/.darkgrade/settings.json`
(mode 0600), shared by CLI and Studio. Installation identity is random; camera identity
uses a separate one-way fingerprint of reliable device serials, never the raw serial. `DARKGRADE_HOME`
changes this directory. File updates are atomic and serialized; stale enrollment writes
cannot overwrite another process's opt-out. Corrupt state fails closed. A lock left by a
crashed process must be investigated before removing it; initialization never steals a lock.

Node clients use the hosted collector by default; `DARKGRADE_TELEMETRY_URL` overrides
the HTTPS origin. `DARKGRADE_CONTRIBUTIONS=0` or `DO_NOT_TRACK=1` overrides cloud
sharing. Saved opt-outs survive updates and Studio migrates its earlier encrypted state.

`createApplicationDiagnostics` from `@darkgrade/contribute/application` is the portable
entry point for custom/browser hosts. Supply an endpoint and persistent store. Optional
`presentNotice` is an embedding-product hook, not a requirement. `observe(transport,
context)` retains the same connection. `configureLinkTelemetry(client)` installs that
client for Link's camera path without importing Node settings in the browser.

Batches flush every 30 seconds, with a bounded queue, deadlines, backoff and idempotent
retry. An active process checks shared preferences before upload. Metadata includes command
codes, responses, durations, byte counts, timestamps and an anonymous connection/session
ID. It excludes serials, image contents, command arguments and free-form errors. A wire
transaction counter only correlates messages within a session; it is not a user identity.

Decoded evidence additionally includes advertised numeric operation/event/property codes
and allowlisted numeric setting descriptors. Unknown codes are retained, but their values,
opaque payloads, strings, network settings and authentication data are excluded. Numeric
values must fit the declared PTP type. Named SDK calls still omit their arguments.

`darkgrade telemetry benchmark --camera VVVV:PPPP` reads a deep camera profile through
the existing Link camera implementation. It exports `~/.darkgrade/profiles/<uuid>.json`
with restrictive permissions even when sharing is off. Progress is printed to stderr;
Ctrl-C requests cancellation between bounded operations. The profile reports complete,
partial or cancelled and retains the exact revision, transport and evidence type. Optional
`--capture`/`--live` perform explicit media transfers; image bytes are never uploaded here.
A completed inventory is not proof that every advertised feature works.

`setConsent(false)` stops cloud uploads and clears the upload queue. Sanitized diagnostics
continue locally in `~/.darkgrade/diagnostics` for debugging. Each process rotates at 2 MiB,
keeps one previous file, and prunes old inactive process files on startup. Set
`DARKGRADE_LOCAL_DIAGNOSTICS=0` to disable local logging. Local files are not automatically
backfilled when sharing is re-enabled. `withdraw()` disables sharing, revokes the credential
and deletes cloud data; interrupted deletion stays pending and can be retried. A subsequent
explicit opt-in after deletion creates a new cloud identity.

Only IDs/status are exposed to Studio's renderer. The local secret authorizes this
installation's upload/deletion; the service stores only its hash. Optional legacy contact
methods remain available to hosts that explicitly configure email, but the current CLI
and Studio use a diagnostic ID instead. Full encrypted transport recordings are separate.

The package root retains the previous single-camera observer API for compatibility. New
integrations should use the shared application/settings entry points. The old signed-grant
collector is not part of the current deployment.

Recording state snapshots contain at most 32 reviewed numeric settings from Link's existing
readback cache. Each value includes its observation age and workflow phase. Requested writes
are separate evidence and cannot update observed state. Missing or old values remain explicit;
snapshotting performs no camera reads, sleeps or synchronous uploads. Canon FixedMovie uses
PTP property `0xd1c2` (libgphoto2 `ptp.h` / `config.c`, `eosmovieswitch`); Canon EDSDK
13.20.21 names the same feature `kEdsPropID_FixedMovie` with a different SDK identifier.
