# Private contribution collector

Receives `@darkgrade/contribute` protocol diagnostics in a private GCP bucket.
No camera payloads, public read endpoint, automatic Matrix promotion or anonymous
enrollment endpoint is provided. This is deployable infrastructure, not a running
production collection service.

## Build and test

From the repository root, after installing the workspace dependencies:

```sh
npm run build --prefix packages/contribute
npm run test --prefix packages/contribute
npm run test --prefix apps/contribution-collector
docker build -f apps/contribution-collector/Dockerfile -t CONTRIBUTION_IMAGE .
```

The image runs as an unprivileged user. Pin its digest when deploying. The Node
process needs `CONTRIBUTION_BUCKET` and `CONTRIBUTION_SIGNING_KEY`; it gets GCS access
through Cloud Run workload identity, not a service-account key.

## GCP deployment

`infra/main.tf` provisions a bucket, narrowly scoped workload service account,
Secret Manager access and Cloud Run service. The bucket blocks public access,
has versioning and soft deletion disabled, and expires only `contributions/`
objects after 30 days. Permanent `revoked/` tombstones prevent future uploads for
withdrawn identities. Cloud Run scales from zero to at most two instances. A generation-guarded quota
allows at most 128 distinct batches per contributor per UTC day (at most 32 MiB
of request bodies). Identical retries share a reservation; quota state expires
after two days. SDK clients honor the quota response’s retry interval.
Cloud request/audit logs have separate retention and may contain network metadata;
configure the project’s logging policy before enrolling external contributors.

Choose the project/region/bucket, push the reviewed image to its registry, and
create a random signing key of at least 32 bytes in Secret Manager through your
existing secret workflow. Do not put the key in Terraform variables, files, logs
or state. Terraform receives only its secret ID and pinned version:

```sh
terraform -chdir=apps/contribution-collector/infra init
terraform -chdir=apps/contribution-collector/infra plan \
  -var='project_id=PROJECT' -var='bucket_name=BUCKET' \
  -var='collector_image=REGISTRY/IMAGE@sha256:DIGEST' \
  -var='signing_secret_id=SECRET_ID' -var='signing_secret_version=1'
```

Review the plan and use the same inputs for apply. Existing organization policy
may prohibit public Cloud Run invocation; in that case use an authenticated
application proxy instead of weakening organization policy.

The endpoint is reachable over HTTPS, but every POST/DELETE requires a signed,
per-contributor token. Invalid requests do not access the bucket. There is no
API for reading stored diagnostics. Applications distribute grants only after
their authenticated enrollment/consent flow. Browser apps should use their
same-origin server proxy; cross-origin CORS access is deliberately not enabled.

## Enrollment and withdrawal

`issueGrant` signs an opaque UUID, expiry (at most 90 days), recorded notice/terms
version and optional explicitly publishable contributor credit. Use it from the
trusted application server; keep the signing key out of browser/npm client code.
The `npm run token -- TERMS_VERSION [CONTRIBUTOR_UUID]` operator command can issue
a 30-day grant using the injected key. Its output is a credential: deliver it
privately and never commit or log it.

`POST /v1/contributions` validates the strict metadata-only schema and stores an
immutable, content-addressed record with contributor provenance and
`review: unreviewed`. Retries do not overwrite an existing observation.

`DELETE /v1/contributions` first writes a permanent revocation tombstone, then
deletes objects belonging to that token's contributor. It is idempotent. Signed
expired tokens still authorize withdrawal. Uploads check revocation before and
after storing, removing late writes when withdrawal races with an upload. Storage
errors fail closed and return retryable errors; withdrawal callers must retry a
failed deletion. A storage outage after a racing write can delay physical removal;
the tombstone still prohibits use, and the 30-day lifecycle bounds retention.
Do not promote any object whose contributor is revoked.

Keep the signing-key version pinned. Before rotating away a key, provide an
authenticated account-based withdrawal path or migrate old grants: otherwise old
withdrawal credentials cannot be verified. Do not remove revocation tombstones.

Deployment also needs the application's enrollment UI, notice, token refresh and
withdrawal-retry UX. This service does not provide an identity provider, terms of
use, central cross-device settings or removal from already-published derivatives.
Contributor linkage is retained so a later promotion/export service can implement
that removal. No npm publication or automatic customer rollout is performed.
