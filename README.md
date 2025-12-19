# @jpglab/fuse

**Connect to & control your camera with TypeScript**

> **Note:** Fuse is in alpha and APIs may change without backwards compatibility.

This library is a comprehensive TypeScript implementation of [ISO-15740:2013](https://www.iso.org/standard/63602.html) which most camera manufacturers from the last 2 decades have used under the hood to accept commands and transmit information. It also contains a partial implementation of various vendor specifications. [`libgphoto2`](https://github.com/gphoto/libgphoto2) and its command line tool [`gphoto2`](https://github.com/gphoto/gphoto2) also use these libraries under the hood.

[![npm version](https://img.shields.io/npm/v/@jpglab/fuse)](https://www.npmjs.com/package/@jpglab/fuse)
[![Bundle Size](https://img.shields.io/badge/bundle%20size-55kB-green)](https://bundlephobia.com/package/@jpglab/fuse)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-1-brightgreen)](https://www.npmjs.com/package/@jpglab/fuse)

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
npm install @jpglab/fuse
```

### Basic Usage

```typescript
import { Camera } from '@jpglab/fuse'

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
import { Camera } from '@jpglab/fuse'

const camera = new Camera()
await camera.connect()

// Listen for camera events
camera.on(camera.getInstance().registry.events.ObjectAdded, (event) => {
    console.log('New object added:', event.ObjectHandle)
})

camera.on(camera.getInstance().registry.events.PropertyChanged, (event) => {
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
        const fileData = await camera.getObject(
            Number(handle), 
            info.objectCompressedSize
        )
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
import { SonyCamera } from '@jpglab/fuse'
// or NikonCamera, CanonCamera, GenericCamera
```

Or specify a device descriptor when initializing the `Camera` constructor:

```typescript
import { Camera, VendorIDs } from '@jpglab/fuse'

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

| Feature                   | Generic PTP | Sony  | Nikon  | Canon         |
| ------------------------- | ----------- | ----- | ------ | ------------- |
| **Connection**            | ✅          | ✅    | ✅     | ✅            |
| **Get/Set Properties**    | ✅          | ✅    | ✅     | ✅            |
| **Event Handling**        | ✅          | ✅    | ✅     | ✅            |
| **Aperture Control**      | ✅          | ✅    | ✅     | ✅            |
| **Shutter Speed Control** | ✅          | ✅    | ✅     | ✅            |
| **ISO Control**           | ✅          | ✅    | ✅     | ✅            |
| **Capture Image**         | ✅          | ✅    | ✅     | ✅            |
| **List Objects**          | ✅          | ✅    | ✅     | 🟡            |
| **Download Objects**      | ✅          | ✅    | ✅     | 🟡            |
| **Live View**             | ❌          | ✅    | ✅     | 🟡            |
| **Video Recording**       | ❌          | ✅    | 🟡     | 🟡            |
| Tested with:              |             | α6700 | Z6 III | EOS R6 Mk.III |

## 📚 Reference

[ISO 15740:2013](https://www.iso.org/standard/59890.html) - PTP specification

---

made with ❤️ by [jpglab](https:/jpglab.ai)
