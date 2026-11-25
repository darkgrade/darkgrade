import type { OperationAvailability } from '@camera/controls'
/**
 * The body capability group of the driver contract (see `@camera/driver/contract`): battery and
 * clock. A driver that can do this provides it; one that cannot leaves it undefined, and Camera
 * reports CameraUnsupportedError.
 */

/** What the camera reports about its power now. A field the camera does not report is absent. */
export interface Battery {
    /** 0–100, when the camera reports a percentage. */
    percent?: number
    /** The camera's coarse level, when it reports one (Canon reports only this). */
    level?: 'empty' | 'low' | 'medium' | 'high' | 'full'
    /** The camera's own estimate for current conditions; never derived from the percentage. */
    minutesRemaining?: number
    /** `unknown` unless the camera says; a USB cable or an outlet is not evidence. */
    powerSource: 'battery' | 'usb' | 'dc' | 'poe' | 'unknown'
    /** Present only when the camera reports it. */
    batteryPresent?: boolean
}

export interface BodyCapability {
    getBattery(): Promise<Battery>
    /** Sets the camera's clock and resolves once the camera confirms it. */
    setClock(moment: Date): Promise<void>
    /** Operations this driver has but cannot do right now, with the reason. */
    availability?(): Promise<Partial<Record<BodyOperationName, OperationAvailability>>>
}

export type BodyOperationName = 'getBattery' | 'setClock'
