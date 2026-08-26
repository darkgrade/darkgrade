# <a href="https://darkgrade.com" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="apps/darkgrade.com/public/darkgrade_combo_dark.svg"><img style="height:30px;" src="apps/darkgrade.com/public/darkgrade_combo_light.svg"></picture></a>

**Connect to & control your camera with TypeScript**

> **Note:** Link is in alpha and APIs may change without backwards compatibility.

This library is a comprehensive TypeScript implementation of [ISO-15740:2013](https://www.iso.org/standard/63602.html) which most camera manufacturers from the last 2 decades have used under the hood to accept commands and transmit information. It also contains a partial implementation of various vendor specifications. [`libgphoto2`](https://github.com/gphoto/libgphoto2) and its command line tool [`gphoto2`](https://github.com/gphoto/gphoto2) also use these libraries under the hood.

[![npm version](https://img.shields.io/npm/v/@darkgrade/link)](https://www.npmjs.com/package/@darkgrade/link)
[![Bundle Size](https://img.shields.io/badge/bundle%20size-55kB-green)](https://bundlephobia.com/package/@darkgrade/link)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-1-brightgreen)](https://www.npmjs.com/package/@darkgrade/link)

## ✨ Highlights

- [x] **🚀 Zero Configuration** - Automatic camera detection and vendor-specific features
- [x] **📦 55kB Bundled** - Lightweight and tree-shakable
- [x] **🔥 1 major dependency** - just `usb` for Node.js
- [x] **🌐 Runs anywhere** - Works in both browser & Node.js
- [x] **🎯 Pure TypeScript** - Full type safety and modern DX
- [x] **✨ Simple API** - Connect and control your camera with minimal code
- [x] **📷 Vendor Extensions** - Extended features for Sony, Nikon & Canon
    - **Sony ⍺ Series** - Live view, video recording, SDIO operations
    - **Nikon Z Series** - Live view, extended properties
    - **Canon EOS R Series** - Remote control, event polling

## 🚀 Quick Start

### Installation

```bash
npm install @darkgrade/link
```

### Basic Usage

```typescript
import { Camera } from '@darkgrade/link'

const camera = new Camera()
await camera.connect()

// Control camera settings
await camera.setIso('800')
await camera.setShutterSpeed('1/250')
await camera.setAperture('f/2.8')

// Capture an image
const { data } = await camera.captureImage()

await camera.disconnect()
```

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

The physical α6700 validation round-tripped and restored AF-A/AF-S, JPEG/RAW, XAVC S HD/XAVC HS 4K, and 3:2/4:3. Its current mode publishes white balance as display-only. The attached lens advertises remote zoom but did not move through either control path, so `sonyPowerZoom()` correctly throws instead of returning a false success. Sony bodies may also require **Shooting → Zoom → Remote Zoom Speed** configuration.

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
import { Camera, IPTransport, VendorIDs } from '@darkgrade/link'

const host = '192.168.1.1' // camera address after Wi-Fi pairing
const localAddress = '192.168.1.2' // address assigned to the isolated adapter
const transport = new IPTransport({
    address: host,
    localAddress,
    clientName: 'Darkgrade darkgrade01',
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

This standard PTP/IP example is currently validated for the Canon-oriented pairing path, not modern Sony PC Remote. The α6700 documents **Wi-Fi Connect**, **PC Remote Function**, **Wi-Fi Direct Info**, and **Access Authen Info** credentials/fingerprint; Darkgrade has not yet implemented or physically validated that authenticated Sony session. Use USB for the Sony controls above until that boundary is complete. The current negative hardware result and next experiment are recorded in [Sony Wi-Fi WIP](apps/docs/link/getting_started/sony-wifi-wip.mdx).

Physical EOS 80D first-pairing validation is still WIP on the reference test bench. On
2026-08-25, the isolated adapter joined the camera AP and routed the camera host correctly,
but the body emitted repeated `ssdp:byebye` notifications, never the expected alive
announcement, and displayed **Connection target not found** before presenting the
Darkgrade client for approval. The transport tests prove protocol behavior against a
two-channel simulator; they do not constitute a successful physical Wi-Fi session.

For a bounded bench command:

```bash
bun run --cwd packages/link bench:ptpip -- \
  --host 192.168.1.1 --local-address 192.168.1.2 --action probe
```

Supported actions are `probe`, `canon-status`, `exposure-status`, `autofocus`, `keep-awake`, `set-focus-mode`, `set-white-balance`, `set-image-format`, `set-continuous-autofocus`, `set-movie-servo-autofocus`, `probe-movie-mode`, `set-movie-format`, `set-iso`, `set-aperture`, `set-shutter-speed`, `storage-status`, `recent-images`, `capture`, `capture-download`, `download-latest`, and `record-clip`. Setters require exact camera-advertised values; recent-object scans are bounded; capture success requires a new card object; movie recording is limited to 1–30 seconds with stop/restoration cleanup. Use `--value`, `--limit`, `--duration-ms`, and `--output` where applicable. The testbench MCP exposes one dedicated tool per action and restores USB separately when the Wi-Fi session is finished.

Canon USB sessions also expose the raw network properties the body publishes:

```typescript
const network = camera.getCanonNetworkState()
// { communicationMode, communicationModeChoices, serverRegion, wftStatus }
```

`camera.setCanonNetworkCommunicationMode(value)` accepts only a mode advertised by that camera. Passing `true` as its second argument bypasses that guard for controlled reverse-engineering only; it is not a general Wi-Fi switch. On the tested EOS 80D, forcing mode `1` was accepted for the USB session but did not advertise an AP or TCP/15740 endpoint and reset to `0` after reboot. Use `bun run --cwd packages/link bench:canon -- --network-only` to inspect these properties; add `--force-network-mode <uint32>` only while recording the USB exchange and with a recovery path available.

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
import { Camera } from '@darkgrade/link'

const camera = new Camera()
await camera.connect()

// Listen for camera events
camera.on(camera.getInstance().registry.events.ObjectAdded, event => {
    console.log('New object added:', event.ObjectHandle)
})

camera.on(camera.getInstance().registry.events.PropertyChanged, event => {
    console.log('Property changed:', event.PropertyName)
})

// Remove event listeners
camera.off(camera.getInstance().registry.events.ObjectAdded)
```

### Live View

```typescript
// Capture live view frame (Sony & Nikon only)
const { data: liveViewFrame } = await camera.captureLiveView()

// Save or display the frame
fs.writeFileSync('liveview.jpg', liveViewFrame)
```

### Video Recording

```typescript
// Start recording (Sony & Canon only)
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

// Get property descriptor
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

You can also import and use vendor-specific camera classes directly:

```typescript
import { SonyCamera } from '@darkgrade/link'
// or NikonCamera, CanonCamera, GenericCamera
```

Or specify a device descriptor when initializing the `Camera` constructor:

```typescript
import { Camera, VendorIDs } from '@darkgrade/link'

// Specify a camera brand for vendor-specific features
const camera = new Camera({
    device: {
        usb: {
            filters: [{ vendorId: VendorIDs.SONY }], // VendorIDs.NIKON, VendorIDs.CANON
        },
    },
    logger: {
        expanded: true, // Show detailed logging
    },
})

await camera.connect()
```

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
| **Mode-aware control inventory** | ✅ standard descriptors | ✅ <sup>5</sup>           | ❌              | ✅              | ✅ standard descriptors    |
| **Still/movie format controls** | When advertised         | ✅ <sup>5</sup>           | ❌              | ✅              | When advertised            |
| **Remote power zoom**         | ❌                         | 🟡 <sup>5</sup>           | ❌              | ❌              | ❌                         |
| **Prompt-free USB reconnect** | Body setting               | Body setting <sup>4</sup> | Body setting    | Body setting    | Body setting               |
| Tested with:                  |                            | α6700<br/>α7 IV<br/>α7 V  | Z6 III          | EOS R6 Mk.III   | E-PL5                     |

**Notes**

1. The earliest versions of PTP date back to 2002 and this was not included in the specification (perhaps not thought of as necessary/useful/possible on the first wave of digital still cameras).
2. Same as (1) above
3. Nikon cameras differentiate between "photo mode" and "video mode" with an on-camera hardware switch and do not typically allow capture of (a) videos while in photo mode or (b) photos while in video mode. There are two workarounds we support:
    - You accept this limitation and get full feature support for photo OR video, but not both at the same time, via the hardware switch. This is optimal if you don't plan to do hybrid shooting within the same session.
    - We allow you to do both at the same time in either switch mode, however when you are capturing in the "wrong" mode" (e.g. you start recording a video while in photo mode), the on-screen display on your camera will be blank and say "Connected to Computer."
4. A physical α6700 test found no advertised persistent USB-mode property or `USBConnectionModeRequest` control. Sending the unadvertised request returned PTP `OK` but the next reconnect still opened the mode chooser; requesting the advertised OSD image restarted the body into its pre-PTP HID mode. With USB unplugged, setting **Setup → USB → USB Connection Mode → Remote Shoot (PC Remote)** on the body was then verified to make the next connection enumerate automatically without a prompt. PTP cannot configure the mode that must be selected before the PTP interface exists.
5. The physical α6700 verified mode-aware focus, still-format, movie-format, and aspect-ratio round trips. White balance was display-only in the tested body mode. The attached lens advertised remote zoom but did not move through either control method, so the API returned an error. Modern α6700 PC Remote uses Sony access authentication and is not implemented by the standard PTP/IP transport; Canon PTP/IP passes simulator tests but EOS 80D first pairing remains physically unverified.
6. The physical E-PL5 MTP mode publishes battery and date/time but no exposure, focus, or capture property. Darkgrade exposes the capability boundary instead of treating vendor recognition as proof of control support.

## 📚 Reference

[ISO 15740:2013](https://www.iso.org/standard/63602.html) - PTP specification

---

made with ❤️ by [darkgrade](https:/darkgrade.com)
