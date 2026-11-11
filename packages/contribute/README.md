# Application diagnostics (v0.2)

Use `@darkgrade/contribute/application` for the current Firestore collector. Initialize
one client per application, after displaying its first-run notice. Sharing starts on;
saved opt-outs and environment overrides (`DARKGRADE_CONTRIBUTIONS=0` or `DO_NOT_TRACK=1`)
remain off. Returning `false` from `presentNotice` opts out immediately. Importing the
package has no collection side effects.

```ts
import { createApplicationDiagnostics } from '@darkgrade/contribute/application'
const diagnostics = await createApplicationDiagnostics({
    endpoint: configuredCollectorOrigin,
    store: secureInstallationStore,
    presentNotice: showDiagnosticsNotice,
})
const { transport, detach } = diagnostics.observe(existingTransport, {
    manufacturer: 'Canon', model: 'EOS 90D', firmware: 'unknown',
    revision: buildGitCommit, dirty: buildIsDirty, transport: 'usb', evidence: 'hardware',
})
// Pass transport to Link's Camera; do not open a second connection.
// A hardware origin describes where diagnostics came from, not a qualified hardware pass.
```

Call `setConsent(false)` to stop and clear unsent data; `withdraw()` additionally revokes
and deletes uploads. Show `status().withdrawalPending` and a retry button calling
`retryWithdrawal()`. Keep the client alive for retry, and call `close()` at application
shutdown. Optional `requestContact(email, {name, publish: true})` requests verified public
credit; `contactStatus()` and `removeContact()` manage it. Credit is a separate choice.
Email functions require an existing enrollment and configured server-side mail delivery.

`@darkgrade/contribute/installation-store` supplies an atomic Node file store with injected
OS credential protection. Electron Studio uses safeStorage and refuses plaintext fallback.
Never embed a shared encryption key. Browser apps must provide durable secure application
storage/proxy handling; do not put the install credential in a URL or expose it to an
untrusted renderer. Use one serialized store owner across processes. The client binds its
saved credential to the HTTPS collector origin and never resets corrupt preferences.

The queue is shared across up to 16 camera contexts and bounded to 1,000 entries plus one
pending retry batch. Headers only are observed; images, parameters, serials, raw errors and
transaction IDs are excluded. Transport cleanup/reset methods continue to work. Firmware
must be a real observation or `unknown`; never infer it from a neighboring camera. A lost
anonymous credential cannot recover withdrawal, so retain secure state across updates.

See `apps/contribution-collector/README.md` for deployment, review/export, limits, and the
24-hour downstream withdrawal/expiry contract. The package and deployment require explicit
release/configuration; this source change does not publish npm or enroll customers.

## Legacy v0.1 API

The root `createContributions` API below remains for old signed-grant deployments. It does
not speak the v2 application-enrollment protocol; new applications use the subpath above.

### @darkgrade/contribute

Camera diagnostics for Darkgrade Link. Explicitly initializing the client enables
metadata collection by default; a missing saved preference means **on**. Importing
the package alone has no side effects. Applications show a diagnostic notice and
an opt-out setting, and obtain a per-contributor upload grant from their server. Never use one shared grant for all customers.

This first protocol sends manufacturer/model, firmware, exact driver revision and dirty-build flag,
transport and reported hardware/synthetic origin, plus command/response/event codes,
byte counts, durations and failure flags. It discards image/data payloads, command
parameters, session/transaction IDs, serial numbers, device descriptors, network
addresses, filesystem paths and exception messages. The application must supply
model/firmware labels, not user-defined camera names or serial numbers.

These diagnostics identify exercised commands and failure patterns; they cannot
replay a camera, independently decode its images or establish a hardware pass.
Darkgrade's existing explicit full-recording API remains a separate private
workflow. This package does not automatically collect or upload those recordings.

## Use with a camera

The repository workspace is ready to build and pack; it has not been published to
npm. Run `npm run build --prefix packages/contribute`, then `npm pack` in that folder.
Node 22.18+ is supported. The default export can also run in a modern browser;
the `/node` consent store uses Node filesystem APIs.

```ts
import { createContributions } from '@darkgrade/contribute'
import { fileConsentStore } from '@darkgrade/contribute/node'

const diagnostics = await createContributions({
    endpoint: process.env.DARKGRADE_COLLECTOR_URL!,
    // Supply a scoped grant from your authenticated application server.
    // Never ship a cloud credential or collector signing key.
    accessToken: async () => obtainFreshGrantFromYourServer(),
    withdrawalToken: async () => readRetainedGrantFromYourSecureCredentialStore(),
    consent: fileConsentStore('/path/to/app-settings/camera-diagnostics.json'),
    camera: {
        manufacturer: 'Canon', model: 'EOS 80D', firmware: '1.0.3',
        revision: '2e5ba0f', dirty: false, transport: 'usb', evidence: 'hardware',
    },
})

// Enabled by default unless this person previously opted out.
// Wrap the chosen Link transport before constructing the camera.
const observation = diagnostics.observe(existingCameraTransport)
// Pass observation.transport to the existing camera constructor/factory.
// It forwards the same connection and events; it does not open a second session.

// After operations and disconnect settle:
await diagnostics.flush()
observation.detach()
diagnostics.close()
```

The application owns the notice and opt-out setting. Do not call `setConsent(true)`
on startup: that would override a saved opt-out. A browser can implement `ConsentStore`
with its own settings storage: return null for a missing preference and false for
an unreadable/corrupt preference. The Node file store follows this behavior. Use one
client per contributor and camera context. Close it before changing accounts,
camera firmware or driver revisions.

While open, the client uploads at most once per minute by default, with one upload
in flight, a 10-second timeout, at most 1,000 queued records plus one retry batch,
and no on-disk diagnostics. The collector also enforces a daily quota; retries
respect its backoff response. Explicit `flush()` is available at workflow boundaries.
An interrupted/failed upload reuses its contribution ID and content for deduplication.
The client drops excess records and reports their count instead of delaying the camera.
Network errors stay separate from camera-operation errors.

## Opt-out setting and withdrawal

- Connect the visible "Share camera diagnostics" setting to `setConsent(enabled)`. It starts on for a new preference and respects existing opt-outs.
- `setConsent(false)` saves the local opt-out immediately, clears queued data and
  aborts uploads. It does not delete previous cloud contributions.
- `optOut()` also revokes this contributor's grant and requests deletion of their
  stored diagnostics. If the cloud is unavailable it throws, remains opted out,
  and can be retried. Keep access to the grant for retry; a correctly signed expired
  grant remains usable for withdrawal. Supply `withdrawalToken` backed by the application's secure credential store so withdrawal does not depend on fresh upload enrollment. Public verification keys remain available after rotation; an in-memory last grant is also retained as a fallback.
- `DARKGRADE_CONTRIBUTIONS=0`, `DO_NOT_TRACK=1` or the application's `disabled`
  callback override stored consent. These stop future collection/uploads; they
  do not contact the cloud to withdraw past contributions.
- `close()` stops the timer, aborts uploads and discards remaining diagnostics.

Revoked identities cannot upload again, even with a freshly issued token for the
same identity. A later participation choice needs new enrollment and a new identity.
An operation spanning withdrawal and re-enrollment is not collected.

## Attribution and Matrix

The collector attaches a pseudonymous contributor ID, recorded terms version,
source module, content hash and receipt date to every contribution. A public credit
name is optional and requires a separate enrollment choice; it is never inferred
from a camera serial or account. Do not claim that a diagnostics contributor lent
the camera or authored unrelated PCAPs.

All uploads are private and **unreviewed**. Before promoting anything into Matrix,
check consent/revocation, source integrity, evidence type and attribution. Retain
the contributor reference on every derived camera/module artifact so withdrawal
can find derived material too. Automatic publication, model promotion and deletion
of already-exported derivatives are not implemented by this collector.
