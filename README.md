# <a href="https://darkgrade.com" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="apps/darkgrade.com/public/darkgrade_combo_dark.svg"><img style="height:30px;" src="apps/darkgrade.com/public/darkgrade_combo_light.svg"></picture></a>

**Connect to & control your camera with TypeScript**

> **Note:** Slate is in alpha and APIs may change without backwards compatibility.

Connect your own USB cameras with the [basic Test Bench](apps/testbench/README.md):
`bun install --frozen-lockfile --ignore-scripts`, then `bun run testbench`.
It runs locally without managed power, a special USB hub or a second Wi-Fi access point.
An optional simulation mode lets you explore the console without hardware. Development uses
Node.js 22.18 or newer and Bun 1.4.3.
The [security review](SECURITY_REVIEW.md) records the migration checklist, audit scope and CI checks.

Slate implements core [ISO-15740:2013](https://www.iso.org/standard/63602.html) PTP operations and partial vendor extensions in TypeScript. It is an independent implementation; [`libgphoto2`](https://github.com/gphoto/libgphoto2) is a protocol reference, not a consumer of Slate. Control availability depends on the attached body, firmware, transport and current mode.

[![TypeScript](https://img.shields.io/badge/TypeScript-blue.svg)](https://www.typescriptlang.org/)

## ✨ Highlights

- [x] **🚀 USB vendor selection** - Automatically selects the uniquely matched body's driver; multiple cameras require a device filter
- [x] **📦 Separate exports** - Camera, terminal, runtime, controls and diagnostics entries; installed dependencies are listed in `packages/slate/package.json`
- [x] **🌐 Explicit host boundaries** - Node.js camera APIs; browser-safe `/controls`, `/runtime/browser` and diagnostics exports
- [x] **🎯 Typed library API** - Concrete protocol definitions infer parameters and decoded values; packed declarations are checked under strict NodeNext
- [x] **🎛️ Shared controls** - One current capability model across Sony, Nikon, Canon and standard PTP controls
- [x] **✨ Simple API** - Connect and control your camera with minimal code
- [x] **📷 Vendor Extensions** - Extended features for Sony, Nikon & Canon
    - **Sony ⍺ Series** - Live view, video recording, SDIO operations
    - **Nikon Z Series** - Live view, focus-point placement, AF-S lens steps, extended properties
    - **Canon EOS R Series** - Remote control, event polling

## 📷 Camera support

**Supported: Sony, Canon and Nikon.** Only the bodies below have been exercised on physical hardware (darkgrade test bench, [`darkgrade/test-bench` docs/camera-compatibility.md](https://github.com/darkgrade/test-bench/blob/main/docs/camera-compatibility.md) and the notes further down this README). Other bodies from these vendors use the same code paths but are untested.

| Manufacturer | Body (USB ID) | What has been verified on hardware |
| --- | --- | --- |
| Sony | α6700 / ILCE-6700 (`054c:0e78`, fw 2.00) | USB property inventory, controls, still/movie formats and AF-point placement; SDK Wi-Fi controls. Re-checked 2026-11-23 on revision `9026c1c`: confirmed generic settings, rapid recording, reconnect/events, live view, still capture and a 10-second movie with complete transfer and independent decoding |
| Sony | FX2 / ILME-FX2 | USB native property inventory, aperture round trip, HDMI; Wi-Fi SDK controls and live preview (no card media) |
| Sony | α7 V / ILCE-7M5 (fw 1.00) | USB only, from Telemetry of 109 Darkgrade Studio sessions on 2026-11-18 to 2026-11-20: session and DeviceInfo, extended property inventory, acknowledged setting writes, live view, still capture with a transferred object (not independently decoded), and a movie start confirmed by the body's movie state. Movie stop and clip transfer, card readiness, reconnect qualification and Wi-Fi are untested. Live-view polls receive many `0x200F` Access_Denied replies while no new frame is ready |
| Canon | EOS R6 Mark III (`04a9:3323`, fw 1.0.1) | USB/PTP exposure and white-balance controls, USB live view, preview zoom, color temperature, live-view AF area, movie recording |
| Canon | EOS 80D (`04a9:3294`, fw 3-1.0.3) | USB controls (aperture, shutter, ISO, white balance, image format), autofocus, movie mode; PTP/IP pairing is work in progress. Re-checked 2026-10-28 on darkgrade01: color temperature 5200 → 5300 → 5200 K with independent readback, native PTP live-view JPEG, a 3-second card movie with an audio track |
| Canon | EOS R6 (`04a9:32f5`) | USB/PTP identification only |
| Canon | EOS R8 Mark II (`04a9:3329`, fw 3-1.0.0) | 2026-11-23 USB qualification on revision `9026c1c`: confirmed generic settings, recording, reconnect/events, live view, still/movie transfer and independent decoding |
| Nikon | Z6 III (`04b0:0454`, fw V2.00) | USB session, aperture and Auto/fixed ISO round trips (no card). Native Wi-Fi (PTP/IP) on 2026-10-29 with an already-registered smart-device profile: settings, still and movie transfer, preview; first-time pairing unverified |
| Nikon | Z5 II / Z5_2 (`04b0:0456`, fw V1.00) | 2026-11-23 USB qualification on revision `9026c1c`: confirmed generic settings, recording-session recovery, reconnect/events, live view, still/movie transfer and independent decoding |
| Nikon | Z 7 (`04b0:0442`) | USB `GetDeviceInfo` probe and bench recovery |

Sony Wi-Fi control uses Sony's licensed Camera Remote SDK, which is not included in this release; install it separately. It is limited to the α6700 and FX2 (`SonyWifiCameraModel`). The separate Bluetooth remote (`SonyBluetoothRemote`) does not need the SDK but has only been tested on the α6700. Other Sony bodies, including the α7 V, are USB only. Slate reads Nikon wireless status where the body advertises the operation, and on the Z6 III, which omits it from DeviceInfo. Canon over Wi-Fi has not been checked on hardware.

**Public captures (not tested by us).** These profiles come from PTP recordings and reports other people published. They show what those bodies sent; they are not Darkgrade hardware tests, and raw files are not redistributed.

| Manufacturer | Body (firmware) | Source | What the capture shows |
| --- | --- | --- | --- |
| Fujifilm | X-T50 (1.31) | [filmkit #12](https://github.com/eggricesoy/filmkit/issues/12) USB capture | DeviceInfo and 61 advertised properties; property reads replay through Slate's definitions |
| Fujifilm | X-T30 (2.01) | [filmkit #13](https://github.com/eggricesoy/filmkit/issues/13) USB capture | DeviceInfo; workflow replay not yet checked |
| Sony | α7 II / ILCE-7M2 (4.0) | [libgphoto2 #981](https://github.com/gphoto/libgphoto2/issues/981#issuecomment-2189832650) USB capture | DeviceInfo and 19 exchanges replay; this older body's session negotiation is not supported by Slate's Sony driver |
| Canon | EOS R5 Mark II (unknown) | [libgphoto2 #1028](https://github.com/gphoto/libgphoto2/issues/1028#issuecomment-2382684065) text export | 29 command/response pairs; no DeviceInfo, firmware or delivered photo |
| Nikon | D500, D850, D7500, Z 5, Z 6, Z 6_2, Z 7, Z 9, Z 30, Z f | [libgphoto2 camera reports](https://github.com/gphoto/libgphoto2/tree/5f55706807397169f7d5deb7b16ff043f4ca4073/camlibs/ptp2/cameras) | Decoded property summaries only; no wire bytes, writes, capture or media |

**Work in progress: every other manufacturer.** These cameras run as standard ISO 15740 PTP devices; vendor operation definitions exist only where listed and are taken from libgphoto2's `camlibs/ptp2` tables. None of the vendor definitions below is hardware-verified. Fujifilm, Panasonic, OM System / Olympus, Leica and Sigma bodies run through the generic driver: the seven standard controls when the body advertises them (shutter speed, ISO, aperture, white balance, focus mode, exposure program, image size), capture when advertised, and no live view or video recording. Their vendor operations can be sent with `send()` but have no driver workflow.

| Manufacturer | Status |
| --- | --- |
| OM System / Olympus | Olympus E-PL5 (`07b4:012f`) tested in MTP mode: session, DeviceInfo, battery level and writable date/time, storage. The body does not offer remote capture in that mode. OM-D and E-series vendor operations (capture, live view, manual-focus drive) are defined; OM Digital Solutions USB vendor `0x33a2` is recognized. |
| Fujifilm | Vendor `GetDeviceInfo` (0x902B) defined. Fujifilm's Wi-Fi protocol is not standard PTP/IP and is not implemented. Public captures of the X-T50 and X-T30 are listed above. |
| Panasonic (LUMIX) | Vendor property, capture, movie-recording and live-view operations defined. |
| Leica | Leica extended session open/close defined (USB vendor `0x1a98`). |
| Sigma | fp data-group, capture-status, snap and live-view operations defined (USB vendor `0x1003`). |
| Pentax / Ricoh Imaging, Hasselblad, GoPro and others | Standard PTP only; no vendor definitions and no hardware testing. |

Transactions are bounded by timeouts, replies are checked against PTP container framing, and failures are typed (`PTPTimeoutError`, `PTPProtocolError`, `PTPDecodeError`, `PTPResponseError`, `PTPDisconnectedError`, `PTPRecoveryRequiredError`). Tune them with `new Camera({ transactionPolicy: { timeoutMilliseconds, deviceBusyRetries } })`. After a USB timeout or framing violation, the next command first sends the still-image class Device Reset Request, waits for the abandoned I/O to settle and reopens the session. Only if that automatic reset fails, or on PTP/IP (which has no class reset), do further commands fail with `PTPRecoveryRequiredError` until a disconnect/connect. Set `automaticUSBReset: false` to keep the latch, or supply `recoverTransport` to replace the reset with your own recovery (for example one that honors recording guards).

## 🚀 Quick Start

### Installation

`@darkgrade/slate` is not published yet. For development in this repository:

```bash
bun install --frozen-lockfile --ignore-scripts
bun run --cwd packages/slate build
```

Workspace applications can then import `@darkgrade/slate`. After publishing, library
consumers will install it with `npm install @darkgrade/slate`. The separately published
`darkgrade` terminal executable bundles its library implementation.

### Basic Usage

```typescript
import { Camera } from '@darkgrade/slate'

const camera = new Camera()
await camera.connect()
try {
    const { controls } = await camera.getCapabilities()
    if (controls.iso?.writable && controls.iso.allowedValues?.includes('ISO 800')) {
        const observed = await camera.setControl('iso', 'ISO 800')
        console.log(observed.value)
    }

    // Requires a body and mode that support remote still capture.
    const { data } = await camera.captureImage()
    if (!data) throw new Error('No image data returned')
} finally {
    await camera.disconnect()
}
```

### One camera control vocabulary

Build controls from the current camera instead of importing vendor classes:

```typescript
const { controls } = await camera.getCapabilities()
for (const control of Object.values(controls)) {
    console.log(control.id, control.value, control.allowedValues, control.writable)
}

// Exact advertised values only; no rounding to a nearby setting.
if (controls.shutterSpeed?.allowedValues?.includes('1/250') && controls.shutterSpeed.writable) {
    await camera.setControl('shutterSpeed', { kind: 'duration', seconds: 1 / 250 })
}
```

`shutterSpeed` is the canonical control. “Shutter speed,” “shutter angle” and
“exposure time” resolve to it through `resolveCameraControl()`. Native angle mode
stays in angle mode. Converting an angle to duration (or the reverse) requires the
actual frame rate, for example `setExposureTime('180°', { framesPerSecond: 24000 / 1001 })`.
`ExposureTime` is the physical-value type, and `setExposureTime()` is its convenience
method. Bulb, Time and flash-sync remain distinct states.

Capability observations report active properties, allowed values and current write
guards. They do not certify a model or prove that an advertised operation is implemented.
Re-read after mode changes; setters re-check before writing. Concrete protocol types
cannot encode the attached body's changing value list.
Strict packed-package checks reject invalid operation parameters, known read-only
property writes, invented control ids and incorrect exposure unions. They also compile
the TypeScript examples in this README, the package README and the quickstart.
See the [control contract](packages/slate/docs/camera-controls.md) and
[release audit](packages/slate/docs/pre-release-audit.md).

### Sony α USB controls

Sony sessions expose the body’s complete SDIO property inventory and preserve Sony’s mode-aware availability flags. Read the inventory before building controls: `writable: true` means the value can be set now, while an enabled flag of `2` is display-only in the current body mode.

```typescript
const properties = await camera.getSonyPropertyStates()

await camera.autofocus() // bounded half-press; release is guaranteed
await camera.setFocusMode('AF-S')
await camera.setSonyImageFormat('RAW + JPEG')
await camera.setSonyJpegQuality('Extra Fine')
await camera.setSonyImageSize('Large')
await camera.setSonyAspectRatio('3:2')
await camera.setSonyMovieFileFormat('XAVC S 4K')
await camera.setSonyMovieRecordingSetting('50M · 4:2:2 10-bit')
await camera.setSonyZoomSetting('Optical Zoom Only')

const zoom = await camera.sonyPowerZoom('tele', 3)
console.log(zoom.beforeMillimetres, zoom.afterMillimetres)
```

All setters accept only values currently advertised by the attached camera. Aperture, shutter speed, ISO, focus mode, and white balance use the cross-vendor `get*`/`set*` methods; Sony still/movie/zoom fields use the explicit methods above. Power zoom always sends stop in cleanup and reports success only after focal-position telemetry changes.

The physical α6700 validation round-tripped and restored AF-A/AF-S, JPEG/RAW, XAVC S HD/XAVC HS 4K, and 3:2/4:3. Its current mode publishes white balance as display-only. Remote zoom is driven through the Sony zoom-operation control code (`SDIO_ControlDevice` `0xd2dd`, int8 direction) and movement is confirmed by focal length **or** Clear Image/digital zoom; on the manual-zoom test lens `sonyPowerZoom()` advances the Clear Image/digital zoom. A power-zoom lens is still required to move the optical focal length, and some bodies need **Shooting → Zoom → Remote Zoom Speed** enabled.

### Standard PTP and Olympus controls

Generic and Olympus sessions can expose a capability-driven standard property inventory. This is the safe entry point for building a control surface because it reports only properties the connected body and current USB mode actually advertise:

```typescript
const properties = await camera.getStandardPropertyStates()
// [{ name, codeHex, value, writable, form, allowedValues, minimumValue, ... }]

const iso = properties.find(property => property.name === 'ExposureIndex')
if (iso?.writable) await camera.setStandardProperty('ExposureIndex', 'ISO 400')

const clock = properties.find(property => property.name === 'DateTime')
if (clock?.writable) await camera.setStandardProperty('DateTime', '20260825T172754')
```

`setStandardProperty()` re-reads the live descriptors, rejects absent/read-only properties, and accepts only an advertised enum choice when the body publishes a choice list. Generic aperture, shutter, and ISO setters use the same guard. `get()` now returns the descriptor’s decoded current value rather than the complete descriptor object.

The attached Olympus E-PL5 (`07b4:012f`, firmware 1.00) was physically inventoried in MTP mode on 2026-08-25. It publishes five property identifiers, but only recognized standard `BatteryLevel` (`0x5001`, read-only) and `DateTime` (`0x5011`, writable); three vendor MTP identifiers remain intentionally non-editable. It does not publish `FNumber`, `ExposureTime`, `ExposureIndex`, `WhiteBalance`, `FocusMode`, or `InitiateCapture`. A date/time write and readback succeeded, while an ISO request was rejected before any write. This matches the [official E-PL5 manual](https://download.omsystem.com/pages/inst/epl5/manual_epl5_ENU.pdf#page=97), which documents Storage/MTP transfer and says camera controls cannot be used while the camera is connected to a computer. Newer Olympus bodies that advertise standard exposure properties will populate the same inventory without a model allowlist.

### PTP/IP over camera Wi-Fi (Node.js)

Darkgrade can use the standard PTP/IP command and event channels instead of USB. Bind the socket to a secondary adapter so joining a camera access point cannot move the controller's normal route:

```typescript
import { Camera, IPTransport, VendorIDs } from '@darkgrade/slate'

const host = '192.168.1.1' // camera address after Wi-Fi pairing
const localAddress = '192.168.1.2' // address assigned to the isolated adapter
const transport = new IPTransport({
    address: host,
    localAddress,
    clientName: 'Darkgrade controller',
})
const camera = new Camera({ transport, vendorId: VendorIDs.CANON })

await camera.connect({ ip: { host, port: 15740, protocol: 'ptp/ip', localAddress } })
const instance = camera.getInstance()
const deviceInfo = await camera.send(instance.registry.operations.GetDeviceInfo, {})
await camera.autofocus()
await camera.keepDeviceOn()
await camera.disconnect()
```

The transport pairs separate command and event TCP connections, uses a stable client identity, supports camera-to-host and host-to-camera data phases, responds to PTP/IP ping packets, and handles fragmented or coalesced TCP frames. It is Node.js-only because it uses `node:net`. The camera must first expose its PTP/IP service and may require approval on its body; on the EOS 80D that means **Wi-Fi function → Remote control (EOS Utility) → Easy connection** after physically disconnecting USB.

This standard PTP/IP example is validated against the Canon-oriented simulator.
The α6700 documents **Wi-Fi Connect**, **PC Remote Function**, **Wi-Fi Direct Info**,
and **Access Authen Info** credentials/fingerprint. `IPTransport` does not implement
that authenticated Sony connection. USB and the existing Sony SDK bridge have
separate connection workflows and evidence; a shared settings API does not certify
pairing or media parity. The standard transport's hardware limits are recorded in
[Sony Wi-Fi WIP](apps/docs/slate/getting_started/sony-wifi-wip.mdx).

Physical EOS 80D first-pairing validation is still WIP on the reference test bench. On
2026-08-25, the isolated adapter joined the camera AP and routed the camera host correctly,
but the body emitted repeated `ssdp:byebye` notifications, never the expected alive
announcement, and displayed **Connection target not found** before presenting the
Darkgrade client for approval. The transport tests prove protocol behavior against a
two-channel simulator; they do not constitute a successful physical Wi-Fi session.

For a bounded bench command:

```bash
bun run --cwd packages/slate bench:ptpip -- \
  --host 192.168.1.1 --local-address 192.168.1.2 --action probe
```

Supported actions are `probe`, `canon-status`, `exposure-status`, `autofocus`, `keep-awake`, `set-focus-mode`, `set-white-balance`, `set-image-format`, `set-continuous-autofocus`, `set-movie-servo-autofocus`, `probe-movie-mode`, `set-movie-format`, `set-iso`, `set-aperture`, `set-shutter-speed`, `storage-status`, `recent-images`, `capture`, `capture-download`, `download-latest`, and `record-clip`. Setters require exact camera-advertised values; recent-object scans are bounded; capture success requires a new card object; movie recording is limited to 1–30 seconds with stop/restoration cleanup. Use `--value`, `--limit`, `--duration-ms`, and `--output` where applicable. The testbench MCP exposes one dedicated tool per action and restores USB separately when the Wi-Fi session is finished.

Canon USB sessions also expose the raw network properties the body publishes:

```typescript
const network = camera.getCanonNetworkState()
// { communicationMode, communicationModeChoices, serverRegion, wftStatus }
```

`camera.setCanonNetworkCommunicationMode(value)` accepts only a mode advertised by that camera. Passing `true` as its second argument bypasses that guard for controlled reverse-engineering only; it is not a general Wi-Fi switch. On the tested EOS 80D, forcing mode `1` was accepted for the USB session but did not advertise an AP or TCP/15740 endpoint and reset to `0` after reboot. Use `bun run --cwd packages/slate bench:canon -- --network-only` to inspect these properties; add `--force-network-mode <uint32>` only while recording the USB exchange and with a recovery path available.

Canon HDMI sensor output can be selected during an open USB session:

```typescript
const priorMode = await camera.getCanonHdmiLiveViewMode()
try {
    await camera.setCanonHdmiLiveViewMode('CAMERA_AND_HOST')
    // Read the camera's independent HDMI/UVC capture path while this session remains open.
} finally {
    await camera.setCanonHdmiLiveViewMode(priorMode)
}
```

The physical EOS 80D resets this property when its PTP session closes. A client that needs continuous Canon HDMI preview must therefore keep one bounded session open, serialize control requests through it or pause it around controls, and restore the prior mode in cleanup. The testbench Camera Console uses the pause/resume design and physically verified a live 1920×1080 Cam Link sensor image before and after autofocus.

### SDK and event protocol evidence

Canon event replay was checked against EDSDK 13.20.21 for Linux, x86-64
`libEDSDK.so` SHA-256 `12627628897d4ff2fce6dc4b04d7c0c4d66a7c2f87c145894f56c18129cc7333`.
Static REA 6.8 / Ghidra 12.1.4 analysis of `CPtpCamera::TranslatePropAvailList32`
confirmed that an empty incoming choice list replaces the previous cached list.
The decoder now preserves this transition, validates record boundaries, and retains
unknown event payloads without guessing their meaning. The analysis is evidence
about this SDK implementation, not physical qualification of every EOS model.
Retained analysis ID: `ev_88bce4e2731485cd5fe26eee896deea2a34ba9063870b4a0c1c522528bfdd1d2`.
Vendor binaries and decompilations remain outside this repository.

`camera.onCanonRawEvent(handler)` exposes owned copies of Canon event bytes for
capture; `camera.offCanonRawEvent(handler)` removes the listener.
`camera.pollNikonEvents()` explicitly drains one Nikon event batch and preserves
unknown records; opening a session does not start a competing event poller.
Nikon movie/SDRAM event definitions and record layouts were cross-checked against
libgphoto2 `camlibs/ptp2/ptp.h` at commit
`02d92fea8a269eb94330a4eade204ba799433606`.
Nikon property access and event polling fall back to legacy operations only on
`OperationNotSupported` (`0x2005`); a property refusal (`0x200a`) remains a refusal.
Protocol regression tests cover framing, empty choices, opaque events, fallback
boundaries, and the public event APIs without requiring or modifying hardware.

## 📖 Usage Examples

### Camera Settings

```typescript
// Get current settings
const currentIso = await camera.getIso()
const currentShutter = await camera.getShutterSpeed()
const currentAperture = await camera.getAperture()

// Set new values
await camera.setIso('1600')
await camera.setShutterSpeed('1/500')
await camera.setAperture('f/4.0')
```

### Event Handling

```typescript
import { Camera } from '@darkgrade/slate'

const camera = new Camera()
await camera.connect()

// Listen for camera events
camera.on(camera.getInstance().registry.events.ObjectAdded, event => {
    console.log('New object added:', event.ObjectHandle)
})

camera.on(camera.getInstance().registry.events.DevicePropChanged, event => {
    console.log('Property changed:', event.DevicePropCode)
})

// Remove event listeners
camera.off(camera.getInstance().registry.events.ObjectAdded)
```

### Live View

```typescript
// Capture live view on a supported Sony, Nikon or Canon body.
const { data: liveViewFrame } = await camera.captureLiveView()
if (!liveViewFrame) throw new Error('No live-view image returned')

// Save or display the frame
fs.writeFileSync('liveview.jpg', liveViewFrame)
```

### Video Recording

```typescript
// Start recording on a supported Sony, Nikon or Canon body with usable media.
await camera.startRecording()

// ... record for some duration ...

// Stop recording
await camera.stopRecording()
```

### File Management

```typescript
// List all objects on camera
const objects = await camera.listObjects()

for (const [storageId, storage] of Object.entries(objects)) {
    console.log(`Storage ${storageId}: ${storage.info.storageDescription}`)

    for (const [handle, info] of Object.entries(storage.objects)) {
        console.log(`  - ${info.filename} (${info.objectCompressedSize} bytes)`)

        // Download a specific object
        const fileData = await camera.getObject(Number(handle), info.objectCompressedSize)
        fs.writeFileSync(info.filename, fileData)
    }
}
```

### Advanced Property Access

```typescript
// Access vendor-specific properties directly
const registry = camera.getInstance().registry

// Get the property's decoded current value.
const propValue = await camera.get(registry.properties.ExposureIndex)

// Set property with type safety
await camera.set(registry.properties.ExposureIndex, '3200')
```

### How It Works

The `Camera` class automatically detects your connected camera's brand and uses the appropriate vendor-specific implementation:

- **Sony α Series** → Automatically uses `SonyCamera` with Sony extensions
- **Nikon Z Series** → Automatically uses `NikonCamera` with Nikon extensions
- **Canon EOS R Series** → Automatically uses `CanonCamera` with Canon extensions
- **Other PTP Cameras** → Falls back to `GenericCamera` with standard PTP operations

Use `Camera` and its capability API for application controls. Vendor classes,
registries and `getInstance()` remain advanced protocol escape hatches; do not
build an application control map from their presence:

Or specify a device descriptor when initializing the `Camera` constructor:

```typescript
import { Camera, VendorIDs } from '@darkgrade/slate'

// Specify a camera brand for vendor-specific features
const camera = new Camera({
    device: {
        usb: {
            filters: [{ vendorId: VendorIDs.SONY }], // VendorIDs.NIKON, VendorIDs.CANON
        },
    },
    logger: {
        renderInTerminal: true, // Opt in to terminal rendering.
        captureConsole: false,
        expanded: true, // Show detailed logging
    },
})

await camera.connect()
```

### Nikon Z6 III focus and live-view status

Validated over USB on Z6 III firmware V2.00:

```typescript
const focus = await camera.nikonAutofocus()
const point = await camera.nikonTouchFocus(0.5, 0.25) // normalized 0–1
const frame = await camera.captureLiveView()
console.log(point.positionVerified, focus.focusAcquired, frame.nikonMetadata)
```

`nikonDriveFocus('near' | 'far', steps)` drives small lens steps in **AF-S**. AF-F can remain busy; MF rejects drive on the tested body. Lens endpoints return named errors. Focus commands require advertised operations; accepted commands and AF-point placement do not establish focus lock.

`getNikonVendorPropertyCodes()` enumerates advertised extended property IDs (355 on the tested body). Unknown properties are not automatically made writable. Fresh live-view metadata includes AF geometry/judgement, recording timers, audio indicators and temperature status. Failed recording setup restores modes it acquired; no-card capture/recording is not reported as successful. Wi-Fi/Bluetooth pairing remains unverified on this Nikon.

## 📊 Feature Compatibility

| Feature                       | Generic PTP                | Sony                      | Nikon           | Canon           | Olympus                    |
| ----------------------------- | -------------------------- | ------------------------- | --------------- | --------------- | -------------------------- |
| **USB connection**            | ✅                         | ✅                        | ✅              | ✅              | ✅                         |
| **Standard PTP/IP transport** | ✅                         | ❌ <sup>5</sup>           | 🟡              | 🟡 <sup>5</sup> | Body-dependent             |
| **Get/Set Properties**        | ✅ advertised only         | ✅                        | ✅              | ✅              | ✅ advertised only <sup>6</sup> |
| **Event Handling**            | ✅                         | ✅                        | ✅              | ✅              | ✅ when advertised         |
| **Aperture Control**          | ✅ when advertised         | ✅                        | ✅              | ✅              | Body/mode-dependent <sup>6</sup> |
| **Shutter Speed Control**     | ✅ when advertised         | ✅                        | ✅              | ✅              | Body/mode-dependent <sup>6</sup> |
| **ISO Control**               | ✅ when advertised         | ✅                        | ✅              | ✅              | Body/mode-dependent <sup>6</sup> |
| **Capture Image**             | ✅ when advertised         | ✅                        | ✅              | ✅              | Body/mode-dependent <sup>6</sup> |
| **List Objects**              | ✅                         | ✅                        | ✅              | ✅              | ✅                         |
| **Download Objects**          | ✅                         | ✅                        | ✅              | ✅              | ✅                         |
| **Live View**                 | ❌ <sup>1</sup>            | ✅                        | ✅              | 🟡              | ❌ on E-PL5                |
| **Video Recording**           | ❌ <sup>2</sup>            | ✅                        | ✅ <sup>3</sup> | 🟡              | ❌ on E-PL5                |
| **Mode-aware control inventory** | ✅ standard descriptors | ✅ <sup>5</sup>           | ✅              | ✅              | ✅ standard descriptors    |
| **Still/movie format controls** | When advertised         | ✅ <sup>5</sup>           | ❌              | ✅              | When advertised            |
| **Remote power zoom**         | ❌                         | 🟡 <sup>5</sup>           | ❌              | ❌              | ❌                         |
| **Wi-Fi / Bluetooth control** | Untested                   | 🟡 α6700, FX2 <sup>7</sup> | 🟡 Z6 III <sup>8</sup> | Untested <sup>5</sup> | Untested            |
| **Prompt-free USB reconnect** | Body setting               | Body setting <sup>4</sup> | Body setting    | Body setting    | Body setting               |
| Tested by us:                 |                            | α6700<br/>FX2<br/>α7 V <sup>9</sup> | Z6 III<br/>Z5 II | EOS R6 Mk.III<br/>EOS R8 Mk.II<br/>EOS 80D | E-PL5 |
| Public capture:               | Fujifilm X-T50<br/>Fujifilm X-T30 | α7 II              | D500, D850, D7500, Z 5, Z 6, Z 6_2, Z 7, Z 9, Z 30, Z f (reports) | EOS R5 Mk.II |            |

This table describes implemented driver paths. Current availability depends on the
body, firmware, transport and mode. The hardware table above records the scope of
physical checks. "Tested by us" means a Darkgrade bench or Studio session on that body;
"Public capture" means a recording or report someone else published, which shows what the
body sent but is not a Darkgrade test. Definitions, simulated scenarios and advertised
operations do not certify a complete camera family or >99% long-run reliability.

**Notes**

1. The earliest versions of PTP date back to 2002 and this was not included in the specification (perhaps not thought of as necessary/useful/possible on the first wave of digital still cameras).
2. Same as (1) above
3. Nikon cameras differentiate between "photo mode" and "video mode" with an on-camera hardware switch and do not typically allow capture of (a) videos while in photo mode or (b) photos while in video mode. There are two workarounds we support:
    - You accept this limitation and get full feature support for photo OR video, but not both at the same time, via the hardware switch. This is optimal if you don't plan to do hybrid shooting within the same session.
    - We allow you to do both at the same time in either switch mode, however when you are capturing in the "wrong" mode" (e.g. you start recording a video while in photo mode), the on-screen display on your camera will be blank and say "Connected to Computer."
4. A physical α6700 test found no advertised persistent USB-mode property or `USBConnectionModeRequest` control. Sending the unadvertised request returned PTP `OK` but the next reconnect still opened the mode chooser; requesting the advertised OSD image restarted the body into its pre-PTP HID mode. With USB unplugged, setting **Setup → USB → USB Connection Mode → Remote Shoot (PC Remote)** on the body was then verified to make the next connection enumerate automatically without a prompt. PTP cannot configure the mode that must be selected before the PTP interface exists.
5. The physical α6700 verified mode-aware focus, still-format, movie-format, and aspect-ratio round trips. White balance was display-only in the tested body mode. Remote zoom is driven via the Sony zoom-operation control code (`0xd2dd`) and confirmed by optical focal length or Clear Image/digital zoom scale (a power-zoom lens is needed to change the optical focal length). Modern α6700 PC Remote uses Sony access authentication and is not implemented by the standard PTP/IP transport; Canon PTP/IP passes simulator tests but EOS 80D first pairing remains physically unverified.
6. The physical E-PL5 MTP mode publishes battery and date/time but no exposure, focus, or capture property. Darkgrade exposes the capability boundary instead of treating vendor recognition as proof of control support.
7. Sony Wi-Fi uses Sony's licensed Camera Remote SDK, which is not included in this release and must be installed separately. Slate accepts only the α6700 and FX2 for it (`SonyWifiCameraModel`). The Bluetooth remote (`SonyBluetoothRemote`) does not need the SDK and has been tested only on the α6700. See [Sony Wi-Fi WIP](apps/docs/slate/getting_started/sony-wifi-wip.mdx).
8. Native PTP/IP was verified on the Z6 III (V2.00) on 2026-10-29 with an already-registered smart-device profile: settings, still and movie transfer and preview. First-time pairing is unverified. Wireless status reads work where the body advertises them and on the Z6 III, which omits them from DeviceInfo. Other Nikon bodies are untested over Wi-Fi.
9. α7 V (ILCE-7M5, firmware 1.00) evidence is USB Telemetry from 109 Darkgrade Studio sessions on 2026-11-18 to 2026-11-20. It shows connection and DeviceInfo, the extended property inventory, acknowledged setting writes, live-view frames, still captures (the body reported four new objects; one 304 KB transfer was inspected but not independently decoded), and a movie start that the body's movie state confirmed. Movie stop and clip transfer, card readiness (Slate's single-slot card fallback is α6700-only), reconnect qualification and Wi-Fi are untested. The body answered live-view polls with `0x200F` Access_Denied 186,751 times while no new frame was ready; Slate waits and asks again, so these are not failed commands, but they dominate its diagnostics.

## 📚 Reference

[ISO 15740:2013](https://www.iso.org/standard/63602.html) - PTP specification

---

made with ❤️ by [darkgrade](https://darkgrade.com)
