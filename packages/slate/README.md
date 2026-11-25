# <a href="https://darkgrade.com" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="../../apps/darkgrade.com/public/darkgrade_combo_dark.svg"><img style="height:30px;" src="../../apps/darkgrade.com/public/darkgrade_combo_light.svg"></picture></a>

Darkgrade Slate package

[darkgrade.com/docs](https://darkgrade.com/docs)

## The Camera API

One `Camera` works the same on every camera that supports an operation. There are no
vendor-named methods: Slate picks the Sony, Canon, Nikon or standard PTP driver when it connects.

```typescript
import { Camera, CameraRefusedError } from '@darkgrade/slate'

const camera = new Camera()
await camera.connect()
try {
    const { controls, operations, lens } = await camera.getCapabilities()
    console.log(controls.whiteBalance?.allowedValues, lens?.focalLengthMillimetres)

    // Each typed setter writes once and resolves to the value the camera read back.
    console.log(await camera.setShutterSpeed('1/250'))
    try {
        await camera.setWhiteBalance('Daylight')
    } catch (error) {
        if (!(error instanceof CameraRefusedError)) throw error // not offered now; nothing changed
    }

    if (operations?.setFocusPoint?.supported) await camera.setFocusPoint(0.5, 0.4)
    const photo = await camera.takePhoto({ destination: 'card' })
    console.log(photo.name, photo.mediaId)
} finally {
    await camera.disconnect()
}
```

The operations are `Camera.discover()`, `connect({ observeOnly })`, `disconnect()`,
`recover()`, `getInfo()`; `getCapabilities()` and `setControl(id, value)`; `autofocus()`,
`setFocusPoint(x, y)`, `resetFocusPoint()`, `nudgeFocus(direction, size)`; `zoomTo(millimetres)`,
`startZoom(direction, { speed })`, `stopZoom()`; `takePhoto()`, `getLiveViewFrame({ overlay })`;
`startRecording()`, `stopRecording()`, `getRecordingState()`; `getCardStatus()`, `listMedia()`,
`getMediaPreview(id, size)`, `downloadMedia(id)`; `getBattery()`, `setClock()`; and
`on`/`off('settingsChanged' | 'mediaAdded')`. Each of the 30 settings has a typed getter and
setter (`getIso()`/`setIso()`, `setPhotoVideoMode()`, `setFocusArea()`, `setVideoQuality()` …).
`getCapabilities().operations` says which operations the attached camera can do now, and why
not; `controls` lists each setting's current value and the choices this camera offers.

Values are Slate's canonical names (`'f/2.8'`, `'ISO 800'`, `'Manual'`, `'Daylight'`), mapped from
each vendor's own words; the compiler rejects a spelling Slate does not know, and at runtime a
value the camera does not offer now is refused before anything is sent. `shutterSpeed` covers
exposure duration and native shutter angle; converting between them requires the actual frame
rate. Search aliases (`exposure time`, `shutter angle`, `picture control`) resolve through
`resolveCameraControl` in the browser-safe `@darkgrade/slate/controls` export. See
[camera controls](docs/camera-controls.md) for the contract and
[pre-release audit](docs/pre-release-audit.md) for measured growth, fixes and limits.

Failures are three types. `CameraUnsupportedError`: this camera cannot do it right now
(`getCapabilities()` says why), and nothing was sent. `CameraRefusedError`: the camera said no,
or the value is not one it offers, and nothing changed. `CameraOutcomeUnknownError` (and its
`CameraConfirmationError`): the command was sent but its result could not be confirmed; it is
never resent, so a photo or a Stop is never repeated by accident. `stopRecording()` and
`stopZoom()` are always allowed.

A value or choice Slate cannot name keeps its raw value in `unrecognized` (`value`,
`choices`); such a control reads `Unrecognized (0x3e7)` and is read-only, and unrecognized
choices are never offered in `allowedValues`.

The same operations are MCP tools (`camera_` and the method in snake_case: `camera_take_photo`,
`camera_set_iso`, `camera_get_capabilities`) from `@darkgrade/slate/runtime/mcp`, and
`darkgrade camera <command>` commands (the method in kebab-case: `darkgrade camera set-iso
'ISO 800'`). `darkgrade cameras` lists attached cameras. All three surfaces are generated from
one operation table.

Vendor drivers, registries, raw send/get/set and vendor diagnostics (Sony buttons and menu
session, Canon network state and magnify/pan, property dumps, wireless pairing) are in the
unsupported `@darkgrade/slate/protocol` export, through `protocolSession(camera)`. Nothing there
is confirmed the way `Camera` operations are. The main camera export requires Node.js; importing
`Camera` does not replace the embedding application's console or process exception handlers.

## Shared diagnostics

Telemetry is part of Slate. Node hosts use `@darkgrade/slate/telemetry/settings`;
browser/custom hosts use `@darkgrade/slate/telemetry`. Schemas and protocol
validation are available from `/telemetry/schema`, `/telemetry/batch`, and
`/telemetry/protocol` without importing camera transports or Node settings.
The `/contribute/*` paths remain compatible aliases. The server's ingestion, email
confirmation, investigation, cleanup and Matrix export live in
`@darkgrade/slate/telemetry/server`; the optional `/telemetry/postgres` adapter supplies
its database. See [telemetry deployment](telemetry/README.md) for the standalone service.
Terminal command behavior is exported separately as `runDarkgradeCli` from
`@darkgrade/slate/cli`. It accepts command arguments, and optionally the host's version and streams, and returns an exit code; importing
it does not open a camera or initialize settings. `packages/cli` supplies the thin
`darkgrade` executable and bundles this runner for npm.
See [diagnostics](docs/contribute.md) for enrollment, opt-out,
withdrawal, local logging and integration details, and the [privacy policy](https://darkgrade.com/privacy)
for what is collected and why.

## Canon EOS R6 Mark III

Canon USB live-view JPEG capture, preview magnification (protocol access: `protocolSession(camera).setCanonLiveViewZoom()`), color temperature and live-view autofocus area controls are verified on the EOS R6 Mark III. Property setters wait for event readback, and live view restores the previous camera/host output. See the [SDK comparison and hardware evidence](docs/canon-r6-iii-sdk-audit.md) for the API, tested capabilities, retained traces and remaining gaps.

## Capability-driven standard controls

Use `camera.getCapabilities()` for generic PTP and Olympus bodies, as for every other. It returns only controls the attached camera advertises, with live value, writability, choices and ranges, and the typed setters (`setIso`, `setAperture`, `setShutterSpeed`) reject absent, read-only and unadvertised values before writing and resolve to the value read back. The raw standard-property inventory is protocol access: `protocolSession(camera).getStandardPropertyStates()` and `setStandardProperty()`.

The Olympus E-PL5 hardware test exposes battery and writable date/time in MTP mode, but no ISO, aperture, shutter, white balance, focus, or remote-capture operation. Newer Olympus bodies automatically gain whatever standard controls they actually publish; support is not inferred from the brand name.

## Video shoots

Use the shared [video shooting APIs](docs/video-shooting.md) for multi-camera takes, verified original transfer, video exposure setup and persistent per-camera evidence. `VideoTake` accepts camera adapters; `UsbVideoRecording` (and `SonyVideoRecording` from `@darkgrade/slate/protocol`) implement the recording/media operations. For a single clip, `camera.startRecording()` and `camera.stopRecording()` are enough. Applications own process leases, storage and their UI.

Validate the built ESM and CommonJS package entries with `bun run test:package` from this directory. This imports the public package under Node and does not connect to hardware.

## Collecting replay evidence over USB

Construct `USBTransport(logger, { maxBulkReadBytes: 16384 })` from `@darkgrade/slate/protocol`, or pass the same option
to `TransportFactory.createUSBTransport()`, while recording Linux usbmon traffic.
The transport reassembles complete PTP containers across these smaller reads;
ordinary connections retain their existing transfer sizes. The bounded
`bench:probe` uses this setting automatically.

This addresses captures whose IN completion has a nonzero transfer length but
`flag_data='D'` and no payload. Linux's
[`mon_bin_get_data`](https://github.com/torvalds/linux/blob/master/drivers/usb/mon/mon_bin.c)
cannot copy IOMMU-coalesced scatter/gather buffers. Its
[`usbfs` submission path](https://github.com/torvalds/linux/blob/master/drivers/usb/core/devio.c)
uses 16 KiB segments and avoids scatter/gather for a one-segment transfer.
This makes new captures possible; it cannot recover bytes absent from an old trace.
Check the resulting capture for complete command, data and response phases before
importing it as camera evidence.

For a reusable protocol snapshot, explicitly run `bun run bench:profile --camera
VID:PID --output /absolute/new-file.json` from this package. Acquire the bench's
camera lease first and release it afterwards. This opens a standard session,
reads DeviceInfo and advertised numeric control descriptors, and closes the
session; it never takes photos or starts recording. Use `--serial` when a USB
model is ambiguous. Defaults are 128 properties and a 60-second collection bound.

`--initialize` uses the vendor session and polls its property/event state. Sony
initialization skips host-priority and save-destination changes. Canon enters and
leaves remote/event mode. `--live-view` additionally opts into live-view activation
and requires initialization; disconnect performs the library's normal cleanup.
Automatic USB resets are disabled: the caller's leased bench workflow owns recovery.

The `darkgrade.ptp-trace/v1` JSON contains complete request/response exchanges,
per-check outcomes, revision and firmware. DeviceInfo serial bytes are removed.
Authentication, media, private text and opaque payloads are omitted and marked;
they must not be replayed as complete exchanges. Safe Canon event records and
Sony numeric descriptors are retained separately as `observations`, preserving
their original bytes for explicitly scoped derived profiles. Sony `0x9202`
capability-list framing is checked against libgphoto2's
`ptp_sony_get_vendorpropcodes` before retention. The file is created privately and
never overwrites an existing capture. Opening an application does not invoke this
hardware command.


## Private encrypted recording bundles

The bench profile workflow writes version 2 bundles when `--recording-directory` is requested. Supply `DARKGRADE_RECORDING_KEY` (canonical base64 for 32 random bytes) and `DARKGRADE_RECORDING_KEY_ID` through the host's secret store. Programmatic callers can pass `{ id, key }` as the fourth argument to `createRecordingBundle`. No key is generated beside the data, and missing keys fail before recording starts. Preserve old keys while their recordings are retained.

Payloads, journal records, provenance and the final trace use AES-256-GCM with independent nonces and bundle/file associated data. The public manifest contains key ID, bundle ID, state and ciphertext hashes, without camera/contributor identity. The encrypted metadata authenticates provenance and file references. This detects tampering for a holder of the decryption key; it is not a public author-attestation signature.

An initial incomplete manifest and fsynced append journal exist before camera operations begin. Blob files are atomically installed and synced before their journal entry. Completion atomically replaces the manifest only after all writes settle. A crash can lose queued/in-flight entries; the inspector recovers committed rows and always labels an unfinished bundle incomplete. It does not extract plaintext onto disk. Data and journal bounds leave room inside the 512 MiB archive limit.

`bench:inspect-recording DIRECTORY NEW_SUMMARY` reads the injected key; `inspectRecording(directory, { [keyId]: keyBytes })` accepts a key ring. Existing version 1 recordings remain readable. Archivers must support the v2 manifest/ciphertext file index before this writer is deployed into an older archive pipeline; do not convert it to plaintext as a compatibility workaround. The existing Matrix archive validator currently accepts v1 and will reject v2 until that consumer is upgraded. These changes do not automatically enable full recordings or send them through metadata contributions.
