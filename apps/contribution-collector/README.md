# Private contribution collector

Receives default-on, metadata-only camera diagnostics in private GCS objects. Applications initialize `@darkgrade/contribute` with a per-user grant and a visible opt-out setting. Raw images and full transport recordings never use this endpoint. This repository contains deployable infrastructure; it does not itself enroll customers or deploy a production service.

## Authorization and rotation

New grants use Ed25519 signatures, a protected `kid`, issue time and an expiry of at most **15 minutes**. The issuer holds the private key in its secret store. The collector receives only public verification keys, indexed by ID:

```json
{"2026-11":{"publicKey":"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----","uploads":true}}
```

Set `CONTRIBUTION_VERIFICATION_KEYS` to this JSON. Add the new public key before changing the issuer; never replace key material under an existing ID. Set an old key's `uploads` flag to false to stop its uploads immediately. **Retain old public keys for withdrawal**: expired and retired-key grants can delete their own contributor's data, but cannot upload. Unknown keys, algorithm substitution, invalid signatures and future-issued grants are rejected. Revoked contributor IDs stay revoked under every key.

The trusted issuer calls `issueGrant` or runs `npm run token -- NOTICE_VERSION [CONTRIBUTOR_UUID]` with injected `CONTRIBUTION_PRIVATE_KEY` and `CONTRIBUTION_KEY_ID`. CLI output is a credential and must be delivered privately. Authenticate enrollment and refresh in the application's server; never embed an issuer key, cloud credential or shared customer grant in an npm/browser client. Default-on diagnostics do not imply public attribution: publishing a credit name remains a separate choice.

For installations that issued the previous HMAC format, optional `CONTRIBUTION_LEGACY_WITHDRAWAL_KEYS` accepts a JSON array of up to four retired secrets **only on DELETE**. HMAC uploads are rejected, even during migration. Keep these in Secret Manager while replacing old withdrawal credentials through authenticated enrollment. Remove the migration secrets only once an account-based withdrawal path or replacement credential covers those users. Fresh deployments do not configure this legacy option.

## Quotas, revocation and interrupted deletion

Firestore transactions reserve at most 128 distinct request digests per contributor per UTC day and check revocation in the same transaction. Identical retries reuse their reservation. Quota documents have a two-day TTL. Firestore `withdrawals/{contributorId}` tombstones never expire. GCS holds only new immutable diagnostic objects, retained for 30 days; no new quota or revocation JSON objects are written there.

DELETE commits a tombstone before removing objects. A failed inline deletion returns a retryable error while uploads remain blocked. A scheduled Cloud Run job retries cleanup every five minutes. It revisits successful tombstones too, catching writes that resumed after an earlier worker completed. A persistent pagination cursor bounds each pass; failed contributors are revisited on a later sweep. The worker logs counts, not credentials or contributor identities. It leaves the tombstone in place after success.

For legacy installations, revocation reads migrate existing GCS tombstones into Firestore on demand, and the worker imports the legacy tombstone prefix before sweeping. Do not expire/delete the old revocation prefix or run the old writer alongside the new deployment. Old quota objects retain their two-day lifecycle. A move to Firestore resets the current legacy quota window; use a maintenance cutover if that one-day allowance matters.

## Public front door

Terraform supplies an external HTTPS load balancer, managed TLS certificate and Cloud Armor policy. POST and DELETE have independent per-IP limits (120 and 30 requests/minute); all other public paths are denied. Cloud Run ingress permits internal/load-balancer traffic, so its public `run.app` URL cannot bypass the front door. Valid grants and Firestore quotas still apply behind it. The collector scales to at most 20 instances with 16 concurrent requests each; this is a cost bound, not the abuse-control mechanism.

Per-IP throttling is approximate and shared NATs share a limit. Browser apps should use an authenticated same-origin application proxy; cross-origin CORS is not enabled. If a proxy concentrates all users behind one IP, choose its edge/rate-limit topology before launch rather than trusting client-supplied forwarding headers. Request/audit logs have their own retention and may contain network metadata.

## Operational visibility

The HTTP process logs only aggregate outcome, status and normalized method. Terraform adds log-based metrics and Monitoring policies for sustained rejection/quota spikes, collector outages and failed withdrawal jobs. Supply existing notification-channel resource names to receive alerts; with no channels, incidents remain visible in Monitoring. Tune thresholds against actual traffic. No tokens, contributor IDs or camera payloads are logged.

## Build, deploy and verify

```sh
npm run build --prefix packages/contribute
npm run test --prefix packages/contribute
npm run test --prefix apps/contribution-collector
docker build -f apps/contribution-collector/Dockerfile -t CONTRIBUTION_IMAGE .
terraform -chdir=apps/contribution-collector/infra init
terraform -chdir=apps/contribution-collector/infra validate
```

Supply a project, region, bucket, collector DNS name, reviewed image digest and public verification-key map. Terraform never receives a private signing key. If migrating legacy HMAC grants, pass the existing migration secret's ID and pinned numeric version, never its value. Import an existing default Firestore database into Terraform state rather than replacing it. The database is deletion-protected; the bucket blocks public access and accidental destruction.

Point the domain's A record at `collector_address`, wait for its managed certificate, then use `collector_url` for enrollment. Verify an authorized POST/DELETE through the load balancer, an invalid grant rejection, throttling, denial of the direct public Cloud Run URL, Firestore quota conflicts, and a failed-then-retried withdrawal job before enrolling customers. A successful Terraform validation is not a deployed-network test.

Runtime configuration is `CONTRIBUTION_BUCKET`, `GOOGLE_CLOUD_PROJECT` and `CONTRIBUTION_VERIFICATION_KEYS`; GCS/Firestore access uses workload identity. The job runs `node dist/withdrawal-worker.js`. The application owns account authentication, the diagnostic notice/setting, short-lived upload-token refresh and retained withdrawal credentials. No automatic publication or deletion from already-exported derivatives is implemented; every derived artifact must retain contributor linkage for that later workflow.
