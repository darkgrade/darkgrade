import type { BodyCapability } from '@camera/driver/body'
import type { ConnectionCapability } from '@camera/driver/connection'
import type { EventsCapability } from '@camera/driver/events'
import type { FocusCapability } from '@camera/driver/focus'
import type { LiveViewCapability } from '@camera/driver/live-view'
import type { MediaCapability } from '@camera/driver/media'
import type { PhotoCapability } from '@camera/driver/photo'
import type { SettingsCapability } from '@camera/driver/settings'
import type { VideoCapability } from '@camera/driver/video'
import type { ZoomCapability } from '@camera/driver/zoom'
import type { GenericCamera } from '@camera/generic-camera'

/**
 * The driver contract: what Camera asks of a vendor driver, so the façade never branches on
 * vendor classes. Every driver has the protocol core (the GenericCamera session it extends) and
 * provides each optional capability group it can do. A group that is absent means "this camera
 * cannot", and Camera reports CameraUnsupportedError; a group never fakes support it lacks.
 *
 * Each vendor's group implementations live in `@vendors/capabilities/<area>`, one file per area,
 * combined by `resolveDriverCapabilities`. One capability interface per area lives in
 * `@camera/driver/<area>`.
 */
export interface CameraDriverCapabilities {
    connection?: ConnectionCapability
    settings?: SettingsCapability
    focus?: FocusCapability
    zoom?: ZoomCapability
    photo?: PhotoCapability
    liveView?: LiveViewCapability
    video?: VideoCapability
    media?: MediaCapability
    body?: BodyCapability
    events?: EventsCapability
}

/** The protocol core every driver has: session lifecycle, transactions, properties and events. */
export type DriverCore = Pick<
    GenericCamera,
    'vendorId' | 'sessionId' | 'registry' | 'connect' | 'disconnect' | 'recover' | 'send' | 'get' | 'set' | 'on' | 'off'
>

export interface CameraDriver {
    readonly core: DriverCore
    readonly capabilities: CameraDriverCapabilities
}

export type CapabilityArea = keyof CameraDriverCapabilities
