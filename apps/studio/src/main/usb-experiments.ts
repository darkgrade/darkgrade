// EXPERIMENT(usb-transport): Developer Mode › USB Transport, four ways to carry the camera's USB connection, kept
// together here so the choice can be removed in one sweep. Search the repository for EXPERIMENT(usb-transport) to
// find every piece:
//
//   apps/studio/src/shared/ipc.ts              USB_TRANSPORT_CHOICES, UsbTransportChoice, Preferences.usbTransport
//   apps/studio/src/main/preferences.ts        the default ('node-usb')
//   apps/studio/src/main/preferences-window.ts the submenu
//   apps/studio/src/main/usb-experiments.ts    this file: everything the choices do in the main process
//   apps/studio/src/main/camera-service.ts     marked hooks: camera options, live-view start and stop, the latest
//                                              frame, and the reconnect when the choice changes
//   apps/studio/src/main/ipc-handlers.ts       one marked branch that sends the Swift loop's surfaces to the window
//   apps/studio/src/main/metal-frames.ts       sendDecodedSurface
//   apps/studio/native/swift-usb/              the Swift transport, the Swift live-view loop and their Node glue
//   apps/studio/scripts/build-native.mjs       the second build block (swift-usb.node)
//   apps/studio/package.json                   the usb-rs dependency (node-usb-rs: the usb package, version 3)
//   apps/studio/electron-builder.yml           usb-rs and its prebuilds kept outside the asar
//
// Slate gained one general option for this (CameraOptions.usb / USBTransportOptions.usb: a WebUSB implementation to
// use in place of node-usb's). It is not specific to this experiment and can stay.
//
//   node-usb         Slate's own transport on the usb package, version 2 (libusb). Nothing here runs.
//   node-usb-rs      Slate's own transport on the usb package, version 3 (Rust, nusb), through CameraOptions.usb.
//   swift-transport  Slate on SwiftUsbTransport (IOUSBHost) as its transport; Slate's commands and live view unchanged.
//   swift-live-view  The same transport, and live view fetched by a Swift thread between Slate's transactions. With the
//                    Metal decoder on, frames are decoded there and reach JavaScript as surfaces. Sony bodies only;
//                    other bodies get the transport alone.
import { Camera, type FocusFrame } from '@darkgrade/slate'
import { parseSonyFocalFrameInfo, TransportType, VendorIDs } from '@darkgrade/slate/protocol'
import { preferences } from '@main/preferences'
import { IPC_EVENTS, type UsbTransportChoice } from '@shared/ipc'
import { app } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { errorMessage } from '@shared/format'
import { loadNativeAddon } from '@main/native-addon'

type CameraOptions = NonNullable<ConstructorParameters<typeof Camera>[0]>
type Transport = NonNullable<CameraOptions['transport']>
type CameraEvent = Parameters<NonNullable<Transport['on']>>[0] extends (event: infer E) => void ? E : never

/** The main process's own channel for a frame the Swift loop decoded; ipc-handlers sends it on as a texture. */
export const SWIFT_LIVE_VIEW_SURFACE = 'internal:swift-live-view-surface'

export interface DecodedSurface {
    /** The IOSurfaceRef, as Electron's sharedTexture takes it. */
    surface: Buffer
    width: number
    height: number
}

interface SwiftFrame extends DecodedSurface {
    /** The frame as its JPEG when it wasn't decoded on the GPU; else empty. */
    jpeg: Uint8Array
    /** Sony's focal frame information, empty when the camera sent none. */
    focal: Uint8Array
}

interface SwiftUsbAddon {
    open(vendorId: number, productId: number): boolean
    close(): void
    send(bytes: Uint8Array): Promise<void>
    receive(maxLength: number): Promise<Uint8Array>
    reset(): boolean
    onEvent(listener: (bytes: Uint8Array) => void): void
    startLiveView(decodeOnGpu: boolean, listener: (frame: SwiftFrame | null) => void): void
    stopLiveView(): void
    liveStatistics(): { frames: number; requests: number; refusals: number; repeated: number; decoded: number }
    latestJpeg(): Uint8Array | null
}

const require = createRequire(import.meta.url)

const loadSwiftAddon = () => loadNativeAddon<SwiftUsbAddon>('swift-usb')

/** Slate's transport interface on the Swift add-on: containers in and out, the class reset and the camera's events. */
class SwiftUsbTransport implements Transport {
    private connected = false
    private handler: ((event: CameraEvent) => void) | null = null

    constructor(readonly addon: SwiftUsbAddon) {}

    async connect(device?: Parameters<Transport['connect']>[0]): Promise<void> {
        const filter = device?.usb?.filters[0]
        if (!filter?.vendorId) throw new Error('The Swift USB transport needs the camera it should open')
        if (!this.addon.open(filter.vendorId, filter.productId ?? 0))
            throw new Error('The Swift USB transport could not open the camera')
        this.connected = true
        this.addon.onEvent(bytes => this.handleEvent(bytes))
    }

    async disconnect(): Promise<void> {
        this.addon.stopLiveView()
        this.addon.close()
        this.connected = false
    }

    send(data: Uint8Array): Promise<void> {
        return this.addon.send(data)
    }

    async receive(maxLength: number): Promise<Uint8Array> {
        const container = await this.addon.receive(maxLength)
        return new Uint8Array(container.buffer, container.byteOffset, container.byteLength)
    }

    isConnected(): boolean {
        return this.connected
    }

    async classRequestReset(): Promise<void> {
        if (!this.addon.reset()) throw new Error('Device Reset Request failed')
    }

    getType(): TransportType {
        return TransportType.USB
    }

    isLittleEndian(): boolean {
        return true
    }

    on(handler: (event: CameraEvent) => void): void {
        this.handler = handler
    }

    off(): void {
        this.handler = null
    }

    /** A PTP event container: length, type 4, code, transaction ID, then up to three parameters. */
    private handleEvent(bytes: Uint8Array): void {
        if (bytes.length < 12 || !this.handler) return
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        if (view.getUint16(4, true) !== 4) return
        const parameters: number[] = []
        for (let offset = 12; offset + 4 <= Math.min(bytes.length, view.getUint32(0, true)); offset += 4)
            parameters.push(view.getUint32(offset, true))
        this.handler({
            code: view.getUint16(6, true),
            transactionId: view.getUint32(8, true),
            parameters,
        } as CameraEvent)
    }
}

/** What the camera connected now is using; set when its options are made. */
let current: { choice: UsbTransportChoice; swift: SwiftUsbTransport | null; sony: boolean } = {
    choice: 'node-usb',
    swift: null,
    sony: false,
}

/**
 * The extra Camera options for the chosen transport (none for node-usb, or where a choice can't be used here, which
 * `log` then says). Called once per connection attempt, before the Camera is made.
 */
export function experimentalCameraOptions(
    vendorId: number | undefined,
    log: (message: string) => void
): Pick<CameraOptions, 'usb' | 'transport'> {
    const choice = chosenTransport()
    current = { choice: 'node-usb', swift: null, sony: vendorId === VendorIDs.SONY }
    if (choice === 'node-usb') return {}
    if (choice === 'node-usb-rs') {
        try {
            const { WebUSB } = require('usb-rs') as { WebUSB: new (options: { allowAllDevices: boolean }) => USB }
            current.choice = choice
            log('USB transport (experimental): Slate on node-usb-rs')
            return { usb: new WebUSB({ allowAllDevices: true }) }
        } catch (error) {
            log(
                `node-usb-rs could not be loaded (${errorMessage(error)}); using node-usb`
            )
            return {}
        }
    }
    const addon = vendorId ? loadSwiftAddon() : null
    if (!addon) {
        log('The Swift USB transport is not available here; using node-usb')
        return {}
    }
    current.choice = choice
    current.swift = new SwiftUsbTransport(addon)
    log(
        choice === 'swift-live-view' && current.sony
            ? 'USB transport (experimental): Swift transport and Swift live-view loop'
            : 'USB transport (experimental): Slate on the Swift transport'
    )
    return { transport: current.swift }
}

/** The choice in effect: Developer Mode off means node-usb, whatever was last chosen. */
function chosenTransport(): UsbTransportChoice {
    const { developerMode, usbTransport } = preferences.get()
    return developerMode ? usbTransport : 'node-usb'
}

/**
 * Calls `reconnect` when the choice changes, so it takes effect at once rather than at the next connection. The
 * camera service decides whether there is a connection to remake.
 */
export function onUsbTransportChanged(reconnect: (choice: UsbTransportChoice) => void): void {
    let chosen = chosenTransport()
    preferences.onChange(() => {
        const now = chosenTransport()
        if (now === chosen) return
        chosen = now
        reconnect(now)
    })
}

/** What the Swift live-view loop needs from the camera service. */
export interface SwiftLiveViewHost {
    camera: Camera
    enqueue<T>(operation: () => Promise<T>): Promise<T>
    broadcast(channel: string, payload: unknown): void
    broadcastFocusFrames(frames: FocusFrame[]): void
    refreshOsdFrame(): Promise<void>
    stopRequested(): boolean
    stillConnected(): boolean
    log(message: string, isError?: boolean): void
}

const STATISTICS_INTERVAL_MS = 10_000
let stopLoop: (() => void) | null = null

/**
 * Runs live view on the Swift loop until it is stopped, when that is the choice and the body is a Sony; resolves
 * true when it ran (the caller then skips its own loop) and false when the caller should run its own.
 */
export async function runSwiftLiveView(host: SwiftLiveViewHost): Promise<boolean> {
    const transport = current.choice === 'swift-live-view' && current.sony ? current.swift : null
    if (!transport) return false
    const { addon } = transport
    // Slate readies the body for live view with one frame of its own.
    await host.enqueue(() => host.camera.getLiveViewFrame())
    let last = addon.liveStatistics()
    let lastAtMs = performance.now()
    let framesAtLastCheck = last.frames
    let returningToShooting = false
    await new Promise<void>(resolve => {
        const finish = (): void => {
            if (stopLoop !== finish) return
            clearInterval(report)
            stopFollowingDecoder()
            stopLoop = null
            addon.stopLiveView()
            resolve()
        }
        stopLoop = finish
        const report = setInterval(() => {
            if (!host.stillConnected()) return finish()
            const framesSoFar = addon.liveStatistics().frames
            // A card read or a shot review leaves the body in playback, which refuses every request the loop sends.
            // A frame of Slate's own returns it to shooting (reads only), as the Node loop's next frame does.
            if (framesSoFar === framesAtLastCheck && !returningToShooting && !host.stopRequested()) {
                returningToShooting = true
                void host
                    .enqueue(() => host.camera.getLiveViewFrame())
                    .catch(error =>
                        host.log(`Live view could not return to shooting: ${errorMessage(error)}`, true)
                    )
                    .finally(() => (returningToShooting = false))
            }
            framesAtLastCheck = framesSoFar
            if (performance.now() - lastAtMs < STATISTICS_INTERVAL_MS) return
            const now = addon.liveStatistics()
            const seconds = (performance.now() - lastAtMs) / 1000
            const frames = now.frames - last.frames
            if (frames > 0)
                console.log(
                    `[live view] ${(frames / seconds).toFixed(1)} fps, ` +
                        `${((now.requests - last.requests) / frames).toFixed(2)} requests per frame, ` +
                        `${now.decoded - last.decoded} decoded on the GPU (Swift loop)`
                )
            last = now
            lastAtMs = performance.now()
        }, 1000)
        const onFrame = (frame: SwiftFrame | null): void => {
            if (!frame) {
                host.log('The Swift live-view loop stopped on a USB error', true)
                return finish()
            }
            if (host.stopRequested()) return
            if (frame.surface.length > 0) {
                const decoded: DecodedSurface = { surface: frame.surface, width: frame.width, height: frame.height }
                host.broadcast(SWIFT_LIVE_VIEW_SURFACE, decoded)
            } else {
                host.broadcast(IPC_EVENTS.LiveViewFrame, frame.jpeg)
            }
            host.broadcastFocusFrames(frame.focal.length ? parseSonyFocalFrameInfo(frame.focal).frames : [])
            void host.refreshOsdFrame().catch(() => {})
        }
        // The loop decodes on the GPU or not as the Metal decoder is switched, at once: it is started again.
        let decodeOnGpu = preferences.get().metalLiveViewDecoder
        const stopFollowingDecoder = preferences.onChange(now => {
            if (now.metalLiveViewDecoder === decodeOnGpu) return
            decodeOnGpu = now.metalLiveViewDecoder
            addon.stopLiveView()
            addon.startLiveView(decodeOnGpu, onFrame)
        })
        addon.startLiveView(decodeOnGpu, onFrame)
    })
    return true
}

/** Ends the Swift loop at once (it finishes the transaction it is in). Does nothing when it isn't running. */
export function stopSwiftLiveView(): void {
    stopLoop?.()
}

/** The Swift loop's newest frame as its JPEG, copied out on demand; null when the loop isn't the one fetching. */
export function swiftLiveViewJpeg(): Uint8Array | null {
    return stopLoop && current.swift ? current.swift.addon.latestJpeg() : null
}
