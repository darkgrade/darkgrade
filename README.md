# <a href="https://darkgrade.com" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="apps/darkgrade.com/public/darkgrade_combo_dark.svg"><img style="height:30px;" src="apps/darkgrade.com/public/darkgrade_combo_light.svg"></picture></a>

**Connect to & control your camera with TypeScript**

> **Note:** Slate is in alpha and APIs may change without backwards compatibility.

Development uses Node.js 22.18 or newer and Bun 1.4.3.
The [security review](SECURITY_REVIEW.md) records the audit scope and CI checks.

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

**Supported: Sony, Canon and Nikon.** Only the bodies below have been exercised on physical hardware (darkgrade test bench, [`darkgrade/test-bench` docs/camera-compatibility.md](https://github.com/darkgrade/test-bench/blob/main/docs/camera-compatibility.md)). Other bodies from these vendors use the same code paths but are untested.

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

## 📖 Documentation

- [Quickstart](apps/docs/slate/getting_started/quickstart.mdx): settings, events, live view, recording, files, errors and recovery
- [Camera controls](apps/docs/slate/getting_started/controls.mdx): one control vocabulary across vendors, shutter speed and shutter angle
- [Vendor features](apps/docs/slate/getting_started/vendor-features.mdx): Sony USB controls and zoom, Canon network and HDMI state, Nikon focus and live-view status
- [PTP/IP over Wi-Fi](apps/docs/slate/getting_started/ptp-ip.mdx) and [Sony Wi-Fi](apps/docs/slate/getting_started/sony-wifi-wip.mdx)
- [Feature compatibility](apps/docs/slate/getting_started/feature-compatibility.mdx): what each vendor's driver implements, including Wi-Fi and the bodies behind each column
- [Camera API](apps/docs/slate/getting_started/camera.mdx) and the PTP reference under `apps/docs/slate/ptp-reference`
- [Control contract](packages/slate/docs/camera-controls.md) and [release audit](packages/slate/docs/pre-release-audit.md)

## 📚 Reference

[ISO 15740:2013](https://www.iso.org/standard/63602.html) - PTP specification

---

made with ❤️ by [darkgrade](https://darkgrade.com)
