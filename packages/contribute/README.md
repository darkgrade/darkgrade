# @darkgrade/contribute

Optional camera diagnostics for Darkgrade Link. Importing this package never starts
collection. A missing consent preference means **off**. Applications must present
their notice, record the user's choice and obtain a per-contributor upload grant
from their server. Never use one shared grant for all customers.

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
    accessToken: async () => process.env.DARKGRADE_CONTRIBUTOR_TOKEN!,
    consent: fileConsentStore('/path/to/app-settings/camera-diagnostics.json'),
    camera: {
        manufacturer: 'Canon', model: 'EOS 80D', firmware: '1.0.3',
        revision: '2e5ba0f', dirty: false, transport: 'usb', evidence: 'hardware',
    },
})

// After the person chooses to participate in your application's settings:
await diagnostics.setConsent(true)
// Wrap the chosen Link transport before constructing the camera.
const observation = diagnostics.observe(existingCameraTransport)
// Pass observation.transport to the existing camera constructor/factory.
// It forwards the same connection and events; it does not open a second session.

// After operations and disconnect settle:
await diagnostics.flush()
observation.detach()
diagnostics.close()
```

The application owns the notice and enrollment UI. Do not put `setConsent(true)`
in automatic startup code. A browser can implement `ConsentStore` with its own
settings storage; missing or unreadable preferences must remain off. Use one
client per contributor and camera context. Close it before changing accounts,
camera firmware or driver revisions.

While open, the client uploads at most once per minute by default, with one upload
in flight, a 10-second timeout, at most 1,000 queued records plus one retry batch,
and no on-disk diagnostics. The collector also enforces a daily quota; retries
respect its backoff response. Explicit `flush()` is available at workflow boundaries.
An interrupted/failed upload reuses its contribution ID and content for deduplication.
The client drops excess records and reports their count instead of delaying the camera.
Network errors stay separate from camera-operation errors.

## Stop or withdraw

- `setConsent(false)` saves the local opt-out immediately, clears queued data and
  aborts uploads. It does not delete previous cloud contributions.
- `optOut()` also revokes this contributor's grant and requests deletion of their
  stored diagnostics. If the cloud is unavailable it throws, remains opted out,
  and can be retried. Keep access to the grant for retry; a correctly signed expired
  grant remains usable for withdrawal.
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
