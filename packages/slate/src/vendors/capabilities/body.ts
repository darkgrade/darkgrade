import type { Battery, BodyCapability } from '@camera/driver/body'
import { CanonCamera } from '@camera/canon-camera'
import { CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'
import { setStandardClock, standardClockUnavailable } from '@vendors/body/standard-clock'
import { readCameraPower } from '@vendors/camera-power'
import { reportingRefusals } from '@vendors/media/ptp-object-index'
import type { CameraPower } from '@workflows/camera-power'

/** The public battery reading; telemetry provenance (`source`, `raw`) stays in CameraPower. */
export function batteryFromPower(power: CameraPower | undefined): Battery {
    const battery: Battery = {
        powerSource: power?.powerSource ?? 'unknown',
        ...(power?.percent !== undefined && { percent: power.percent }),
        ...(power?.level !== undefined && { level: power.level }),
        ...(power?.remainingMinutes !== undefined && { minutesRemaining: power.remainingMinutes }),
        ...(power?.batteryPresent !== undefined && { batteryPresent: power.batteryPresent }),
    }
    if (Object.keys(battery).length === 1 && battery.powerSource === 'unknown')
        throw new CameraUnsupportedError('getBattery', 'This camera does not report its battery')
    return battery
}

/**
 * Each vendor's battery and clock. Battery: Sony's property snapshot, Canon's EOS level after the
 * standard BatteryLevel, the standard BatteryLevel elsewhere (`readCameraPower`). Clock: Sony's
 * Date/Time Setting with its confirmation event, the standard DateTime property elsewhere.
 */
export function bodyCapability(driver: CameraDriverInstance, owner: Camera): BodyCapability {
    let clockCheck: { sessionId: number | null; reason: string | undefined } | undefined
    const vendor = driver instanceof SonyCamera ? 'sony' : driver instanceof CanonCamera ? 'canon' : 'standard'
    return {
        getBattery: () => reportingRefusals('getBattery', async () => batteryFromPower(await readCameraPower(owner, vendor))),
        setClock: moment =>
            reportingRefusals('setClock', async () => {
                if (driver instanceof SonyCamera) await driver.setDateTime(moment)
                else await setStandardClock(driver, moment)
            }),
        async unavailableOperations() {
            if (driver instanceof SonyCamera) return {}
            if (clockCheck?.sessionId !== driver.sessionId)
                clockCheck = { sessionId: driver.sessionId, reason: await reportingRefusals('setClock', () => standardClockUnavailable(driver)) }
            return clockCheck.reason ? { setClock: clockCheck.reason } : {}
        },
    }
}
