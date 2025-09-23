# @jpglab/fuse

**Connect to & control your camera with 2 lines of TypeScript**

> **Note:** Fuse is in alpha and APIs may change without backwards compatibility.

This library is a comprehensive TypeScript implementation of [ISO-15740:2013](https://www.iso.org/standard/63602.html) which most camera manufacturers from the last 2 decades have used under the hood to accept commands and transmit information. It also contains a partial implementation of various vendor specifications. [`libgphoto2`](https://github.com/gphoto/libgphoto2) and its command line tool [`gphoto2`](https://github.com/gphoto/gphoto2) also use these libraries under the hood.

[![npm version](https://img.shields.io/npm/v/@jpglab/fuse)](https://www.npmjs.com/package/@jpglab/fuse)
[![Bundle Size](https://img.shields.io/badge/bundle%20size-55kB-green)](https://bundlephobia.com/package/@jpglab/fuse)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-1-brightgreen)](https://www.npmjs.com/package/@jpglab/fuse)

## ✨ Highlights

- [x] **🚀 2 Lines to Connect** - Zero-configuration with auto-discovery
- [x] **📦 55kB Bundled** - Lightweight and tree-shakable
- [x] **🔥 1 Dependency** - Minimal footprint (just `usb` for Node.js)
- [x] **🎯 Pure TypeScript** - Full type safety and modern DX
- [x] **✨ Simple API** - 2 lines to connect to a camera
- [x] **📷 Works with any PTP camera**
    - [x] **Sony ⍺ Series Cameras**
    - [ ] **Canon EOS R Series Cameras**
    - [ ] **Nikon Z Series Cameras**

## 📦 Installation

```bash
npm install @jpglab/fuse
```

## 🚀 Quick Start

```typescript
import { Camera } from '@jpglab/fuse'

// Connect to camera - that's it!
const camera = new Camera()
await camera.connect()

// Take a photo
const photo = await camera.takePhoto()
await photo.save('./photo.jpg')

// Disconnect
await camera.disconnect()
```

### Manual Discovery

```typescript
import { Camera, listCameras } from '@jpglab/fuse'

// Auto-discover specific vendor
const camera = new Camera({ vendor: 'sony' })
await camera.connect()

// Or discover by model
const camera = new Camera({ model: 'A6700' })
await camera.connect()

// Or list all available cameras first
const cameras = await listCameras()
console.log(cameras)
// [
//   { vendor: 'Sony', model: 'A6700', usb: { vendorId: 0x054c, productId: 0x0e78 } },
//   { vendor: 'Canon', model: 'R5', usb: { vendorId: 0x04a9, productId: 0x1234 } }
// ]

// Connect to specific camera
const camera = new Camera(cameras[0])
await camera.connect()
```

### Operations

```typescript
await camera.setISO(400)
await camera.setShutterSpeed('1/250')
await camera.setAperture('f/5.6')
await camera.setExposureMode('manual')

// Take photo
const photo = await camera.takePhoto()
```

### Events

```typescript
// Event handling
camera.on('photo', photo => {
    console.log(`Photo captured: ${photo.filename}`)
})

camera.on('error', error => {
    console.error(`Camera error: ${error.message}`)
})

camera.on('disconnect', () => {
    console.log('Camera disconnected')
})
```

## 🏗️ Architecture

Clean, layered architecture with dependency injection and pluggable components:

- **Client Layer** ← 2-line API to connect
- **Camera Layer** ← Vendor-specific (Sony, Canon, etc.)
- **Core PTP Layer** ← ISO 15740 implementation
- **Transport Layer** ← USB (implemented), TCP/IP (coming soon)

## 🧪 Development

```bash
# Install
npm install

# Test
npm test:all            # All tests

# Build
npm run build           # Build library
npm run all             # Compile, lint, format, test

# Dev
npm run dev             # Development server
```

## 📁 Project Structure

```
src/
├── client/          # New simplified API layer
│   ├── camera.ts    # Main Camera class
│   ├── discovery.ts # Auto-discovery functions
│   ├── photo.ts     # Photo class
│   └── types.ts     # TypeScript interfaces
├── application/     # High-level abstractions
├── camera/          # Camera implementations
│   ├── generic/     # Generic PTP
│   ├── vendors/     # Sony, Canon, Nikon
│   ├── properties/  # Device properties
│   └── camera-factory.ts
├── core/            # PTP protocol (ISO 15740)
├── transport/       # USB, TCP/IP
│   └── transport-factory.ts
└── tests/           # Integration tests
```

## 📚 Reference

[ISO 15740:2013](https://www.iso.org/standard/59890.html) - PTP specification

---

made with ❤️ by [jpglab](https:/jpglab.ai)
