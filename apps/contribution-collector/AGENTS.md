# Telemetry and the collector

Read the root `AGENTS.md` first; this file only adds to it.

Notes for work on telemetry: the collector in `apps/contribution-collector`, the diagnostics
client in `packages/slate/src/contribute`, and the Matrix export. The repository-wide rules
are in the root `AGENTS.md`.

## Contact identity

Email linking reuses `requestContact`, `contactStatus`, `removeContact` and the collector's
existing single-use challenges. Keep Resend credentials in server Secret Manager configuration;
never put them in Slate, CLI, Studio, diagnostic events, Matrix exports or client preferences.
Private support lookup belongs in Telemetry, never Matrix exports. Join current/pending
addresses to retained sessions by installation ID; shared camera fingerprints never merge
people. Pending submissions are claims. Keep the old verified identity until the latest
replacement is confirmed; generation checks must prevent old links restoring it. Confirmation
expires after two hours, and logout/withdrawal remove pending as well as verified identities.
Use existing per-session signal summaries to distinguish explicit failures from busy/retry
warnings; do not label every non-OK response as a red error.
Plain `telemetry status` stays offline; `status --email` explicitly reads the collector.
Do not claim email delivery from an HTTP acknowledgement or a fake sender: verify a real
provider receipt and, when authorized, the recipient's inbox. Sending requires a verified domain.

## Collector database

Telemetry scale and identity (2026-11-13): the collector keeps `telemetry_sessions` and
`telemetry_session_signals` current with statement triggers on `telemetry_events`; the overview,
session list, filters and suggestions read those and never scan raw events. Deletions decrement
counts at once and mark the session stale; maintenance refreshes time bounds and label sets.
A one-time startup rebuild (marker `sessions-v1` in `telemetry_rollup_state`) holds a brief table
lock. Any new writer of `telemetry_events` is covered by the triggers; a change to how a signal
or error is derived must change the trigger functions, the queries and the marker together.
Events recorded before a connection's identity read adopt the single identity the same session
read later (derived columns only; signed payloads stay as uploaded). Native Sony sessions read
standard DeviceInfo once per connection after authentication; a refusal is logged and ignored.
The in-session read was confirmed physically on the a6700 and FX2 (2026-11-14): it follows
authentication and precedes the first property read. Slate remembers which inventory and setting
facts this installation already shared in `reported-facts.json` under the settings directory
(short hashes only), because bench camera work runs in short-lived workers; a fact is shared
again when it changes or after six hours. Probe and vendor-session scopes are kept separately.
Benchmark profiles are exempt and stay complete. Each kind of fact has its own memory entry
(vendor scope, operation and field set): a Canon setting's value and its allowed values, or two
operations listing one inventory category, must not replace each other.
The unknown-code queue reads `telemetry_unknown_codes` (per installation, kept by the same
triggers, marker `unknown-codes-v1`); session, body and signal scopes still read events.
Collector rules learned the hard way on 2026-11-14:
- Startup must not queue table locks. DDL on `telemetry_events` and the summary tables
  (including `CREATE INDEX IF NOT EXISTS`, `ALTER ... IF NOT EXISTS`, `CREATE TRIGGER`) runs only
  until those objects exist (`eventsSchemaReady`, `summarySchemaReady` in postgres.ts). A schema
  change to those tables must update the readiness check, or it will never be applied.
- Maintenance works in short transactions. One long transaction blocks the next start, and a
  backend keeps running after its collector instance is gone; only a database restart ended it.
- Triggers must stay cheap for bulk deletes: never search events from inside them. A summary row
  that needs a new source is listed in `telemetry_unknown_code_repairs` and repaired by
  maintenance within a time budget; it is hidden from the queue until then.
A connection that fails before any identity read (body asleep or off) is attributed to the
camera that last reported itself at the requested USB identity, from `known-cameras.json` in the
settings directory: manufacturer and model only, firmware `unknown`, and a body fingerprint only
when one exact serial was requested. A body never seen stays Unknown. Sony Wi-Fi attempts carry
the model the caller named; the trust (`fingerprint`) step shares the following connect's session.
Collector purge markers `purge-unidentified-2026-11-14` and `-14b` are one-time and dated.

## What clients record

Recording diagnostics retain bounded observed-cache snapshots around preparation, start/stop,
failure and cleanup. Each setting keeps its numeric PTP value and observation age. Acknowledged
writes never update this cache; reconnect/disconnect clear it. Snapshotting adds no USB reads,
waits or cloud calls. Canon FixedMovie is allowlisted as a numeric readback using the supplied
EDSDK/libgphoto2 references; SDK and PTP property IDs are different. Deploy collector and Matrix
schema support before candidate Slate clients upload snapshots. Missing settings stay unknown;
no snapshot implies that recording or independent media validation passed.

Telemetry benchmark now exports a deep sanitized camera profile through Slate's existing
camera session. Keep inventories and allowlisted numeric descriptors separate from media,
opaque payloads and private settings. Partial/cancelled exports retain evidence without
claiming unsupported features. The CLI saves profiles even with sharing off; Test Bench
supplies leases and exposes the Darkgrade `camera_benchmark` tool. Collector research
findings require exact source, model, firmware, revision, transport and evidence scope,
plus attributed references; they expire/withdraw with the source and never certify hardware.
Shared admission quotas must remain consistent across collector instances.

Matrix imports all validated batches as diagnostic evidence automatically, with optional human review separately labeled. Committed ingestion watermarks prevent live uploads starving pagination; review, withdrawal and credit changes invalidate exports. Camera fingerprints are absent when reliable serial identity is unavailable, and reconnect must clear stale body identity.

Telemetry autocomplete uses bounded authenticated database suggestions scoped by other filters,
including old sessions. Preserve hardware/synthetic provenance and hide credentials/contact details.
Inspection modals keep summaries readable and raw evidence collapsed; test keyboard selection, stale
responses, Escape/focus return, friendly installation labels, and narrow screens.

## Ingestion, operators and settings

The ingestion audit adds early bounded SDK flushes, email login/logout, paged session lists,
an operator review queue and generation-consistent Matrix exports. Reviewed evidence expires
with its original diagnostic. Test with real Postgres and a separate growth-test database:
reviewing or withdrawing during an export deliberately invalidates its cursor.
Terraform now includes encrypted-only SQL connections, server-side deletion protection and
minimal health/CPU/disk monitoring. Notification delivery requires verified channel IDs;
email requires a configured sender. Do not claim live email delivery from a mock sender test.

The ingestion implementation replaced project 18 with one HTTPS service and Postgres.
`apps/contribution-collector/src/postgres.ts`
stores flat telemetry_events plus operational state; main.ts performs its own cleanup and
serves an operator-authenticated /internal timeline. Firestore/GCS/grant collector deployment
code and the separate cleanup job were removed. Terraform provisions Cloud Run + Cloud SQL
with restricted configuration secrets; validation is not a live deployment.

The Outpost Telemetry app uses `/internal/api` for bounded issues/session reports,
installation lookup, batch review, full Matrix exports and authenticated revocation.
Never expose credential hashes. Contact details belong only to the authenticated private
contributor support lookup, not event reports or Matrix exports. Operator mutations require JSON, the
operator header, no browser Origin and an exact ID confirmation for deletion. Keep
deletion shared with the installation API so pending cleanup and revocation stay consistent.
`bootstrap_principal` in Terraform grants scoped actAs on the collector service account;
it does not grant organization or billing-account access.

Slate instruments existing USB/PTP-IP sessions, with Unknown identity until GetDeviceInfo. Custom
transports need explicit telemetry configuration, and loopback IP defaults to synthetic.
Do not mistake a real socket for proof of physical hardware. Sony SDK bridge calls have separate named-operation telemetry; no SDK arguments or payloads
are collected. USB SDK model/firmware remain Unknown when the bridge cannot supply them. Model/firmware/revision/transport,
source hashes and contributor attribution stay attached; metadata never becomes a hardware
pass. All validated Matrix diagnostic snapshots replace fully and expire within 24 hours.

Direct-source bench execution resolves revision/dirty state from the Slate source checkout when
build constants are absent. Normal Node/Bun process exit attempts a bounded final flush; forced
exit preserves buffered local metadata but cannot promise cloud delivery. Keep these lifecycle
checks alongside transport attribution tests.

Node applications and packages/cli share packages/slate/src/contribute/settings: one random installation
ID and scoped secret in ~/.darkgrade/settings.json, mode 0600. Installation identity stays random; camera-body fingerprints are separate versioned hashes of manufacturer/model/serial. Never retain the raw serial in telemetry. Default sharing is enabled; there is no first-run notice in CLI/Studio and no UI
retention-age blurb. The built-in hosted collector is used when no endpoint override is supplied. Opt-out stops
cloud uploads but keeps bounded sanitized local logs. Delete disables sharing first and
preserves retry state. Respect environment overrides and saved/corrupt preferences. Native
Studio migrates the earlier encrypted preference before initializing the shared file.

Run SDK, real Postgres collector, CLI, Studio and Slate tests; validate Terraform and the
actual HTTP container. Test the event listener before/after observer replacement: telemetry
must not steal a camera's event handler. Run the Matrix export/import contract without
promoting metadata or mutating the installed Matrix app. No hardware operations are needed
for ordinary telemetry validation. Keep unrelated dependency symlinks intact.
