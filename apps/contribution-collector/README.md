# Camera diagnostics pipeline

This is the lean pipeline in Explainer Studio project 18: one Cloud Run HTTP service,
Firestore, and a daily withdrawal job using the same image. The default service is
`src/telemetry.ts`, started by `src/main.ts`. It has **not been deployed** by this change.

Applications use `@darkgrade/contribute/application` once for all their cameras. A visible
first-run notice explains collection before observation begins. Sharing starts on, saved
opt-outs remain off, and corrupt settings fail closed. A random installation credential
is created lazily, saved securely before uploading, and bound to the collector origin.
The application sends one bounded batch every five minutes; importing Link alone does
not collect anything. Photos, serials, command parameters, paths, and free-form error
messages are excluded. Full encrypted recordings remain a separate, explicit workflow.

## Identity, storage, and deletion

- `POST /v2/installations`: enroll with the current notice version. Returns a random
  install ID and secret; only its SHA-256 is stored. This credential authorizes uploads
  and withdrawal. There is no shared signing secret, issuer service, or token-refresh job.
- `POST /v2/batches`: authenticated, strict v2 envelope; up to 16 camera contexts,
  1,000 entries, 256 KiB, and 512 distinct batches per installation per UTC day.
  Exact retries are idempotent; conflicting reuse of a batch ID is rejected.
- `GET /v2/installation`: this installation's withdrawal/contact status.
- `DELETE /v2/installation`: revoke first, then delete. A `202` response explicitly means
  deletion is pending. Repeated deletion uses the retained key; it never re-enrolls.
- `POST /v2/contact`: optional email and separately chosen public credit. Confirmation
  links use a fragment, not a query string. Challenges expire in 15 minutes, are single
  use, and cannot revive a withdrawn installation or replaced email request.
- `DELETE /v2/contact`: removes contact information and invalidates pending links.
  Exports resolve current verified credit rather than retaining old names in patterns.

Firestore collections are `installations`, `diagnostics`, `contacts`, `contactChallenges`,
`uploadQuotas`, `enrollmentQuotas`, `reviewedPatterns`, and `maintenance`. Email is stored
only in the contact/challenge collections. Only confirmed email hashes group installs;
this grouping does not grant cross-install upload or deletion access. Diagnostic documents
expire after 90 days. Firestore TTL deletion is asynchronous; review rejects expired data
immediately. Quotas expire after two days; permanent revocation tombstones do not expire.

Uploads, quota changes, contact confirmations and reviews atomically verify the installation
version when committing. A revoked installation cannot gain a late upload or reviewed
pattern. The REST adapter uses atomic version preconditions, including read-only guards,
with bounded conflict retries. It does not hold read locks across separate HTTP requests.

The daily worker drains pending withdrawals in bounded pages, including reviewed patterns.
It keeps its pagination cursor, reports failures, and can safely restart after interruption.
An application remembers pending withdrawal across restarts, clears queued diagnostics,
and retries without creating a new identity. A lost credential has no anonymous recovery
path; applications must use durable OS-backed storage, not reset their identity on errors.

## Reviewed evidence and Matrix

Operator commands use Firestore IAM; install keys cannot review or export diagnostics.
On a workstation with an authorized gcloud login, set `TELEMETRY_OPERATOR_AUTH=gcloud`
and `GOOGLE_CLOUD_PROJECT`. Inside Cloud Run, omit the operator option to use workload
identity. No token is printed or written to disk by these commands:

```sh
npm run review --prefix apps/contribution-collector -- INSTALL_ID_BATCH_ID
npm run export:matrix --prefix apps/contribution-collector -- /private/path/matrix-diagnostics.json
npm run cleanup --prefix apps/contribution-collector
```

Review retains the source record, digest, installation, notice version, camera model,
firmware, driver revision, transport and synthetic/hardware origin. It summarizes command
codes, outcome counts and timings; it does not invent image validation or replay payloads.
An operator must inspect a candidate before invoking review. This is not an automatic
training or camera-definition promotion job.

Matrix's companion `import_diagnostics` MCP tool accepts the entire JSON export, replacing
the prior snapshot. `get_diagnostics` returns scoped evidence; each camera has a collapsed
summary. Snapshots expire after at most 24 hours and older/conflicting snapshots cannot
restore withdrawn rows. Regenerate and import daily. Withdrawal blocks review/export
immediately; existing downstream copies converge on refresh or expiry, not instantly.
Do not copy patterns into untracked permanent definitions. Any future training artifact
must retain these source IDs and participate in the same withdrawal lifecycle. No full
recordings are exported. Monthly BigQuery analysis remains a later extension.

## Local validation

Build both workspaces before tests or Docker packaging:

```sh
npm run test --prefix packages/contribute
npm run test --prefix apps/contribution-collector
docker build -f apps/contribution-collector/Dockerfile -t darkgrade-telemetry .
```

`test:emulator` uses the production Firestore REST adapter. It requires
`FIRESTORE_EMULATOR_HOST=127.0.0.1:PORT`; otherwise that test is explicitly skipped.
The CI workflow starts the official Firestore emulator, checks concurrency, scoped
paginated deletion, review/export and revocation races, then runs the real HTTP container.
`npm run smoke --prefix apps/contribution-collector` requires `TELEMETRY_SMOKE_URL`
(HTTPS, or loopback HTTP for tests). It creates and withdraws its own synthetic fixture,
checks duplicates/invalid credentials/revocation, and never contacts a camera.

## GCP bootstrap and deployment

Required operator inputs: a billing-enabled project, region, private Terraform state bucket,
billing account, alert channels, and a deployment identity permitted to create these
resources. Optional email requires a verified Resend sender and an API secret in Secret
Manager; only its secret ID and numeric version enter Terraform. A different email provider
can implement the existing `sendContact` interface. No credentials belong in repository
files, npm clients, Terraform variables, or workflow output.

1. Create a dedicated private, versioned GCS bucket for Terraform state. Initialize with
   `terraform -chdir=apps/contribution-collector/infra init -backend-config=bucket=STATE_BUCKET`
   and a dedicated `-backend-config=prefix=darkgrade-telemetry`. Import an existing default
   Firestore database if the chosen project already has one; never replace it.
2. Supply `project_id`, `region`, `billing_account`, `notification_channels`, `public_url`
   and an image digest through a local untracked tfvars file. Budget defaults to USD 50.
   For a new registry, target only `google_artifact_registry_repository.telemetry` first;
   an initial syntactically valid placeholder digest is acceptable for this registry-only
   step, never for a service deployment.
3. Build and push a **linux/amd64** image to
   `REGION-docker.pkg.dev/PROJECT/darkgrade-telemetry/collector`, then set `collector_image`
   to the returned immutable digest. Review a full Terraform plan before applying it.
4. If using the standard Cloud Run URL, bootstrap with `public_url=https://pending.invalid`
   and email unconfigured. Read the `collector_url` output, set `public_url` to that origin,
   and apply again **before distributing an application configuration**. A custom hostname
   instead needs verified DNS/TLS mapping; this configuration does not create DNS records.
5. Run the public smoke command, execute the cleanup job and inspect Monitoring. Test a
   confirmation email if configured. Deliver a test alert and verify billing recipients.
   An infrastructure validation or a container test is not verification of live IAM,
   email delivery, DNS/TLS, or alert delivery.
6. Set GitHub environment `telemetry` variables: `TELEMETRY_PROJECT`, `TELEMETRY_REGION`,
   `TELEMETRY_PUBLIC_URL`, `TELEMETRY_WIF_PROVIDER`, and `TELEMETRY_DEPLOY_ACCOUNT` from the
   Terraform outputs. The manual deployment workflow builds/tests an image, authenticates
   with GitHub OIDC, updates the service and cleanup job, and runs smoke/cleanup checks.
   Federation permits only `darkgrade/darkgrade` at `deploy_ref` (main by default). For a
   deliberate pre-merge trial, configure the exact review branch and deploy with an
   authorized operator identity; do not broaden the trust condition to all forks/refs.
7. Record the deployed digest in Terraform inputs after each workflow run so a later
   apply cannot inadvertently roll back the image. Roll back both the service and cleanup
   job together using the last verified digest; do not delete the database or tombstones.

The service uses its own workload identity and Firestore permissions. The scheduler can
invoke only the cleanup job. The deployment identity can publish images/update Run and
act as the service identity, but cannot administer the database. Private service state
uses a deletion-protected Firestore database. The HTTP endpoint is public by design;
explicit CORS origins are configurable, and install authentication applies independently.

This lean design bounds enrollment at 1,000 installations/day across instances and limits
accepted per-install uploads. Three instances and a budget **are not a hard spend cap** or
a comprehensive DDoS defense: invalid requests still consume resources. Monitor traffic
before widening rollout; add an edge rate limiter if abuse warrants it. Cloud Run request
logs can include network metadata even though application logs contain only aggregate
status/method/outcome. Set log retention in the deployment project accordingly.

Terraform adds a 5xx-rate alert, failed-cleanup alert, and billing budget thresholds.
Monitoring channels must be supplied for notifications; an empty list only creates
incidents in the console. Budget recipients follow the billing account configuration.

## Legacy code

`collector.ts`, the signed-grant issuer, GCS adapter and old withdrawal worker remain for
compatibility tests and explicit migration work. They are **not** routed by the v2 service
or scheduled by this Terraform. The earlier 30-day/GCS/Ed25519/load-balancer design is
superseded for this new, undeployed pipeline. Do not point old v1 clients at v2 without
upgrading their application enrollment/settings integration.
