# Camera controls

Applications instantiate `Camera`. Slate owns property mapping and current
availability; Studio and harnesses must not maintain another vendor control table.

```ts
import { Camera } from '@darkgrade/slate'
import { resolveCameraControl } from '@darkgrade/slate/controls'

const camera = new Camera()
try {
    await camera.connect() // Requires one matching USB body, or an explicit device filter.
    const { controls } = await camera.getCapabilities()
    const iso = controls.iso
    if (iso?.writable && iso.allowedValues?.length) {
        const observed = await camera.setControl('iso', iso.allowedValues[0]!)
        console.log(observed.value) // Display the camera readback, never the requested value.
    }
    console.log(resolveCameraControl('shutter angle')) // shutterSpeed
} finally {
    await camera.disconnect()
}
```

The ids, display labels and search aliases live in `src/camera/controls.ts`.
Per-vendor protocol names live in `src/vendors/control-properties.ts`.
An alias resolves a name; it does not change units, choose a camera mode or bypass a
write guard. Native property names/codes remain in each observation's `source`
for debugging. Low-level vendor classes and raw `get`/`set` are retained for
protocol work; their presence is not a capability advertisement.
Existing `getShutterSpeed()`/`setShutterSpeed()` keep their compact native protocol
requests for compatibility with scoped camera profiles. Use `getExposureTime()`/
`setExposureTime()` or `setControl('shutterSpeed', ...)` for unit conversion and
native angle mode; the old methods do not infer a capture frame rate.
When vendor initialization is refused, a partial session stays caller-owned for
standard diagnostics. Always close the attempt with `disconnect()` in `finally`.

## Shutter speed and angle

The canonical id and display name are `shutterSpeed` / “Shutter speed.”
`exposureTime`, “exposure time,” `shutterAngle` and “shutter angle” are searchable
aliases, not additional control ids. `ExposureTime` describes the physical value
and its units; `getExposureTime()` is the quantitative accessor.

| Observed value | Meaning |
| --- | --- |
| `{ kind: 'duration', seconds: 1 / 50 }` | Fixed duration |
| `{ kind: 'angle', degrees: 180 }` | Native shutter angle |
| `{ kind: 'bulb' }` | Exposure ends on release |
| `{ kind: 'time' }` | Camera's distinct Time setting |
| `{ kind: 'flash-sync' }` | Camera's distinct flash-sync setting |
| `{ kind: 'auto' }` | Camera's advertised automatic shutter state |

`getExposureTime()` returns this union. `setExposureTime()` accepts it or a label
such as `1/50`, `0.02s` or `180°`. A bare numeric string is seconds, never an angle.
Converting angle and duration requires an explicit `framesPerSecond`:

```ts
await camera.setExposureTime('180°', { framesPerSecond: 25 })
await camera.setExposureTime({ kind: 'duration', seconds: 1 / 48 }, { framesPerSecond: 24 })
```

The conversion is `seconds = degrees / (360 * framesPerSecond)`. Supply the actual
capture rate; `24`, `24000/1001`, `30` and `30000/1001` are different. Slate does not
infer it from a formatted frame-rate label or verify the caller's context against
the body. If the exact result is absent from the body’s choices, the write fails.
Exposure optimization may intentionally choose a nearby value separately.

Nikon photo/movie fractions retain their full numerator/denominator. Standard PTP
ExposureTime retains its 1/10000-second units; neither is decoded as the other.
In Nikon angle mode, Slate writes the advertised angle property and verifies it,
without switching to shutter-speed mode. Recording/buffer idle evidence is
required for that write. Camera mode changes between discovery and writing fail.

## Capability observations and writes

`getCapabilities()` returns `observedAt`, `controls` and `advertisedOperations`.
The operation list is `null` on the licensed SDK bridge, which has no standard
PTP DeviceInfo inventory; unknown is not an empty supported-operation list.
Controls only appear after a recognized property is observed. Vendor recognition,
an SDK enum table or a definition in a registry cannot create a control.
The inventory is collected sequentially, not an atomic snapshot of physical dials.

Sony availability flags, Nikon fresh descriptors and Canon event inventories keep
their own semantics. Canon's event data does not publish a dynamic writability
flag: the generic API requires a settable definition and current advertised
choices, so a visible control without choices can remain unavailable for writes.
Empty or ambiguous lists do not become writable. A failed readback remains failure.

`setControl()` rechecks live availability and returns a confirmed `CameraControlState`.
Sony and Canon reuse their authoritative bulk property inventories; targeted writes
do not reread DeviceInfo. Nikon reads the requested descriptor and its current guards;
standard PTP reads the requested advertised property. Bulk vendor protocols still
require a bulk refresh. Confirmation polls observations only and never repeats a write.
An ignored write, disappearing control or changed property produces an error.
`CameraConfirmationError` includes `operation`, `expected` and `observed`; transport
and decode failures retain their original error types. Hosts can show the error and
refresh actual state. Most values use exact advertised labels; colour temperature
takes a number, and shutter speed takes the union above.
Canon photo/movie format labels map back to the original advertised structured
record, not a guessed enum. Duplicate labels disable that write instead of
selecting an arbitrary raw format. Nikon movie ISO/focus/aperture/white balance
reuse the owned-session shot controller and its idle checks. Automatic exposure
preparation, physical mode changes, transport recovery and camera ownership remain
explicit host/workflow responsibilities.

Nikon movie ISO under Auto ISO is reported as Auto rather than as a dormant fixed value.
Its fixed ISO writes through the generic control API are unavailable until the current
manual/Auto-ISO state supports them. Existing specialized preparation/ISO APIs can
be used explicitly; capability discovery never turns Auto ISO off.

On native Sony bodies with an advertised writable Auto/Manual gain switch, an explicit
ISO write may use that switch. Slate retains only manual sensitivities actually observed
in this owned session when Auto hides the ISO enum; disconnect/reconnect clears them.
Starting directly in Auto with no manual choices observed stays read-only. After switching,
the setter validates the fresh manual enum and restores Auto if the ISO write is refused.
Capability discovery itself never switches gain mode or writes a sensitivity.

Supported mappings cover Sony native USB controls, Nikon photo/movie extensions,
Canon common exposure/focus/white-balance and structured formats, and standard PTP.
Sony's licensed SDK bridge also implements `CameraControlSession` with the same
ids and exposure union, adapting its existing SDK control mapping. SDK angles use
thousandths of degrees while Nikon uses hundredths; adapters retain that distinction.
Connect the SDK bridge through its existing advanced transport API, then use
`getCapabilities()`/`setControl()`/`getExposureTime()`/`setExposureTime()` on either
kind of connected session.
An absent control is unobserved in this session, not proof the body can never do it.
The shared setting contract does not claim parity of pairing, recording, media or
other operations between SDK/Wi-Fi and native PTP.

## Confirmed recording changes

`Camera.getRecordingState()` and the Sony SDK camera return `idle`, `recording`,
`starting`, `stopping` or `unknown` according to the backend's real observations.
Native Sony failure and interval-recording waiting values return `unknown`;
neither those values nor SDK recording failure prove idle. Nikon uses its movie-status descriptor and
Canon uses its event-reported recording state. Missing observations stay unknown.

`startRecording()` requires verified idle state, sends Start once, and waits up to
five seconds for recording. `stopRecording()` waits for verified idle state after
Stop (up to fifteen seconds); a fresh idle observation makes Nikon/Canon Stop idempotent.
Sony still sends one movie-button release, so an ignored Start does not leave a pressed
control behind. This release is an explicit Stop action, not a replay of Start.
Native Sony movie-button transitions wait at least 1.5 seconds after the preceding
write attempt completes: a body can acknowledge an earlier release or press while
ignoring it. The driver delays that single command; readback still determines success
and a refusal still raises an error.
`prepareRecordingMode()` explicitly selects Sony's advertised corresponding movie
mode and returns a restoration handle. It checks camera-reported movie capacity,
without inferring free space from Sony's zero-capacity, read-only host storage.
A readable zero in an observed movie mode prevents Start and reports no remaining
recording time; unavailable values and photo-mode zero remain unknown.
Restoration requires confirmed idle and polls fresh mode availability for up to
five seconds while the body finalizes files. It writes the original mode once;
missing readiness preserves the movie mode and raises a confirmation error.
Sony video-take workflows use this same preparation.
These bounds govern observation polling; the configured transport bounds still apply.
The shared host operation queue serializes rapid control and recording changes within
one Camera object. Hosts still own physical leases and mode preparation/restoration.

Studio applies state updates inside its queue, displays pending/unconfirmed recording
separately, and retains Stop and the connection if stop cannot be confirmed.
Confirmation is not evidence that a playable file was saved. Card file discovery,
transfer and independent decoding remain separate qualification steps.

## Types and host boundaries

Concrete operation/property definitions infer parameters and decoded values.
Camera choices remain runtime facts, so arbitrary strings are validated on the
body's current descriptor rather than claimed to be a compile-time enum.
The packed ESM and CommonJS declarations are checked with `strict`,
`moduleResolution: NodeNext`, `skipLibCheck: false` and invalid-input assertions
by `bun run test:package`.

`@darkgrade/slate/controls` contains only vocabulary, types and conversions and is
browser-safe. The main camera export uses Node USB/network/SDK services.
Browser applications use the shared browser runtime with a host-provided client.
There is no claim that the complete main export bundles for an arbitrary browser.

Terminal logging is opt-in and never suppresses uncaught exceptions or unhandled
promise rejections. Packed Node checks require fatal errors to retain a nonzero exit.

Transport construction also stays out of the host console. USB transport options cover
its implemented WebUSB injection and bulk-read limit; interface/alternate/claim selection,
USB timeout, buffer size and transport-level retry flags were never implemented and are
no longer advertised. IP factory options reuse `IPTransportOptions`. Configure PTP retries
and transaction deadlines through `CameraOptions.transactionPolicy`.
