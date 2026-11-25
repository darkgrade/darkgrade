/**
 * The body capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can do this provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError with the reason. Signatures follow the plan's "The API" section; the
 * body slice owns this file and finalizes the result types when the operations land.
 */
export interface Battery {
    levelPercent?: number
    minutesRemaining?: number
    source: 'battery' | 'usb' | 'dc' | 'unknown'
}

export interface BodyCapability {
    getBattery(): Promise<Battery>
    setClock(moment: Date): Promise<void>
}
