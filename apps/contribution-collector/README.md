# Darkgrade telemetry

One HTTPS service and one Postgres database. The service validates and batches camera
metadata, serves a private investigation timeline, and performs its own cleanup. No
Firestore, GCS recording store, email provider, separate cleanup worker or scheduler is
required. This replaces the undeployed project 18 infrastructure.

## Local development

Build `packages/contribute` and this app, then run a local Postgres 17 database. Set
`DATABASE_URL` to its connection string and `TELEMETRY_PUBLIC_URL` to the intended HTTPS
origin. `npm start` starts the service on port 8080. `npm test` includes real Postgres
integration tests when `DATABASE_URL` is set. `npm run smoke` uses `TELEMETRY_SMOKE_URL`
(HTTPS, or explicit loopback HTTP for local checks). It creates and deletes only its own
synthetic installation; it does not operate a camera.

The Dockerfile is built from the repository root after both packages are built. Production
connects through Cloud SQL's authenticated Unix socket; direct remote Postgres connections
must use certificate-verified TLS. Do not expose a plaintext Postgres port publicly.

## Data and behavior

- `telemetry_events` is the flat investigation table: installation/session IDs, client/server
  timestamps, model, firmware, Link revision, transport, operation code and flexible JSONB
  properties, and optional versioned camera-body fingerprints. Fingerprints hash manufacturer, model
  and reliable serial identity; raw serials, images, command parameters and free-form errors are excluded.
- `telemetry_state` holds installation credential hashes, immutable original batches, quotas,
  review records and deletion state. Original batch hashes retain provenance for Matrix.
- Serializability keeps uploads, revocation and review consistent. Retrying an identical
  batch is idempotent; changing an existing batch's contents is rejected. No plaintext
  installation secrets enter the database.
- Registration accepts a locally generated random identity and secret so network retries
  cannot create multiple identities. Revocation also tombstones pending registration;
  delayed requests cannot recreate withdrawn records.
- Batches expire after 90 days. The resident service removes expired batches and their flat
  events, and retries interrupted withdrawals every minute. It catches up after downtime.
  Reviewed patterns expire with their original batch and remain withdrawal-linked;
  minimal credential tombstones prevent replay.
- Admission limits: 1,000 registrations/day across the service and 4,096 batches/day per
  installation. Shared Postgres windows also limit registrations to 30/minute and uploads
  to 600/minute globally and 120/minute per installation. Repeated registrations consume
  the same burst budget. Before parsing bodies or querying Postgres, each process admits
  at most 100 requests/second and 32 concurrent requests. Rejections return Retry-After;
  withdrawal is not blocked by an exhausted upload budget. These are application limits,
  not a DDoS shield or proof the caller is an official Link client.
  Bodies are capped at 256 KiB, 1,000 entries and 16 camera contexts.
- Deep benchmarks add typed advertised inventories and allowlisted numeric descriptors.
  `/internal/api/profile` exports their retained evidence and `/internal/api/protocol`
  groups unknown codes by exact model, firmware, revision, transport and evidence class.
  Operator-only `/internal/api/protocol-finding` attaches interpretations and exact source
  references to an original unknown observation. Tested findings require a regression-test
  reference; the label is an operator assertion, not automatic hardware qualification.
  Expired/withdrawn sources disappear from these views immediately, including while
  cleanup is pending. Matrix automatically receives the same source-linked findings.
- Optional email linking uses a single-use confirmation. CLI `telemetry login EMAIL`
  can enroll before camera use; `logout` removes the association without changing sharing.
  It stays unavailable until `TELEMETRY_EMAIL_API_KEY` (Resend) and a verified
  `TELEMETRY_EMAIL_FROM` are configured. Anonymous `whoami` works without email.

## Investigation and Matrix

Set a random `TELEMETRY_ADMIN_KEY` (at least 32 characters) to enable `/internal`. Sign in
as `outpost` with that key over HTTPS. The compact timeline filters by installation, camera
model or session and displays at most 500 observations. Full payloads and database secrets
are never sent to this view. It is an operator tool, not a customer-facing recording page.
The page reports observations and camera responses; it does not infer a proven root cause.

Outpost's Telemetry app uses the same operator credential through `/internal/api`.
It reads bounded issue/event reports and anonymous installation IDs, reviews original
batches, exports full Matrix snapshots and revokes/deletes an installation. Sessions and
the unreviewed batch queue use cursors so older evidence remains reachable. Mutations
require JSON, a server operator header and no browser Origin; an ID deletion also confirms
the exact ID. Credentials and optional contact details are never returned. Internal
installation labels live in Outpost and are not contributor attribution.
Fully deleted installation tombstones are omitted from the normal list; an exact ID lookup
still verifies revocation. Their minimal key hashes remain to reject delayed or replayed uploads.

Operators use database credentials with these scripts:

```
npm run review -- INSTALLATION_ID_BATCH_ID
npm run export:matrix -- /private/path/reviewed-patterns.json
npm run cleanup
```

Review retains model, firmware, transport, revision, synthetic/hardware origin and hashes.
Non-OK response codes count as error observations, including retries; they do not establish
a failed final workflow. Matrix's existing `import_diagnostics` tool replaces the complete
snapshot. The scalable path uses `/internal/api/matrix/page` and Matrix's
`import_diagnostics_page`: 100 source records per page, staged in SQLite and published
only after the final page. All validated originals are eligible without human review;
review remains a separate nullable label. Outpost runs this immediately at server startup
and every five minutes, with bounded retries. A committed ingestion watermark excludes
later uploads without restarting an export. Review, withdrawal and contributor changes invalidate a
running export; the client restarts with a fresh generation. Records expire within
24 hours or at the source expiry, whichever comes first. A replacement removes withdrawn
evidence. Neither
an observation nor a reviewed pattern automatically becomes a hardware pass. Automated
agent diagnosis/PR creation and exact byte replay remain future work, not this timeline.

## GCP deployment

Terraform provisions Cloud Run and Cloud SQL for Postgres, plus the registry, restricted
service identities and configuration secrets needed to run those two services. Cloud Run
supplies HTTPS; Cloud SQL supplies encrypted storage/backups. No custom load balancer is
needed. One resident, CPU-allocated Cloud Run instance runs cleanup and scales to at most
two. This has an idle cost; it is a simplicity choice, not a scale-to-zero claim. The small
Postgres instance is single-zone, with backups and point-in-time recovery, not HA.
Terraform also enables server-side deletion protection, encrypted connections, an external
HTTPS/database uptime check, and sustained database CPU/disk alerts. Set
`notification_channels` to existing verified Cloud Monitoring channel IDs; without them,
alerts create console incidents only. Billing budgets require separate billing-account
permissions. Optional `email_api_key` and `email_from` inject the sender through Secret Manager.

1. Select the billing-enabled project and region. Create a private versioned Terraform
   state bucket; run `terraform init -backend-config=bucket=BUCKET -backend-config=prefix=telemetry`.
2. Supply `project_id`, `region`, `collector_image` pinned by digest, `public_url`, a random
   `database_password` and a separate random `admin_key`. Inject secrets through the
   deployment environment; do not commit tfvars or print a plan/state containing secrets.
   Sensitive values still exist in Terraform state: restrict access to that bucket.
   If the bootstrap identity lacks permission to act as the new runtime identity, set
   `bootstrap_principal` to its `serviceAccount:EMAIL` (or `user:EMAIL`). Terraform grants
   Service Account User on the collector identity only, before deploying Cloud Run.
3. For a new registry, provision just `google_artifact_registry_repository.telemetry`, build
   and push a **linux/amd64** image, then apply the full reviewed plan with its real digest.
   For the first default Cloud Run hostname, use `https://pending.invalid`, read the
   `collector_url` output and apply again with the actual URL before configuring any client.
   A custom hostname needs separately configured DNS/TLS.
4. Test `/health` (public Cloud Run frontends reserve `/healthz`, which remains an internal probe alias), enrollment, duplicates, opt-out, withdrawal and `/internal`. Verify
   database/network permissions and backup restoration before accepting customer diagnostics.
   Configure project-level billing notifications; instance counts are not hard spending caps.
5. Node Link, CLI and Studio use the built-in hosted collector by default.
   `DARKGRADE_TELEMETRY_URL` overrides it for self-hosting. Saved opt-outs and environment
   overrides still disable uploads; automatic clients also stay local under `NODE_ENV=test`.
   Publishing packages is a separate release step.

The manual GitHub deployment workflow uses OIDC, restricted to this repository and
`deploy_ref` (main by default; explicitly choose the open PR's branch for staging). Set the
`telemetry` environment variables `TELEMETRY_PROJECT`, `TELEMETRY_REGION`,
`TELEMETRY_PUBLIC_URL`, `TELEMETRY_WIF_PROVIDER`, `TELEMETRY_DEPLOY_ACCOUNT` from Terraform.
It updates only the web service and smoke-tests it. Record its image digest in Terraform
inputs so a later apply does not roll it back. Database destruction is protected.

Nothing has been deployed by building or validating these files. No live Firestore data
needs migration in this workspace; do not point this plan at an unrelated existing database.
