import type { SmokeArea } from '@scripts/camera-smoke/smoke-area'

const EVENT_WAIT_MILLISECONDS = 15_000
/** Sony CameraOperatingMode: Record while shooting, Playback while showing the card. */
const SONY_OPERATING_MODE_CODE = 0xd0bc

/**
 * Takes one photo to the card and waits for `mediaAdded` (and any `settingsChanged` the shot causes),
 * then checks that `off` stops delivery. The photo stays on the card.
 */
export const eventsSmoke: SmokeArea = {
    name: 'events',
    description: "on('settingsChanged' | 'mediaAdded') and off, around one photo to the card",
    async run(camera, report) {
        let settingsChanges = 0
        let mediaAdded = 0
        const onSettings = () => settingsChanges++
        let resolveAdded: () => void = () => {}
        const added = new Promise<void>(resolve => (resolveAdded = resolve))
        const onMedia = () => {
            mediaAdded++
            resolveAdded()
        }
        camera.on('settingsChanged', onSettings)
        camera.on('mediaAdded', onMedia)
        try {
            const before = (await camera.listMedia()).length
            await camera.captureImage({ includeInfo: false, includeData: false })
            const timedOut = await Promise.race([
                added.then(() => false),
                new Promise<boolean>(resolve => setTimeout(() => resolve(true), EVENT_WAIT_MILLISECONDS)),
            ])
            if (timedOut) throw new Error(`No mediaAdded within ${EVENT_WAIT_MILLISECONDS / 1000} s of a photo to the card`)
            const after = (await camera.listMedia()).length
            report.confirmed("on('mediaAdded')", { events: mediaAdded, filesBefore: before, filesAfter: after })
            report.confirmed("on('settingsChanged')", { eventsDuringThePhoto: settingsChanges })
        } finally {
            camera.off('mediaAdded', onMedia)
            camera.off('settingsChanged', onSettings)
        }
        const stopped = mediaAdded
        await new Promise(resolve => setTimeout(resolve, 1000))
        report.confirmed('off', { deliveredAfterOff: mediaAdded - stopped })

        // The shot can leave review up; Slate re-arms shooting on the next live-view frame by itself.
        let data: Uint8Array | undefined
        try {
            data = (await camera.captureLiveView({ includeInfo: false })).data
        } catch (error) {
            if (!/not supported/i.test(String(error))) throw error
            return report.skipped('live view after the photo', String(error))
        }
        if (!data || data[0] !== 0xff || data[1] !== 0xd8) throw new Error('The live-view frame after the photo is not a JPEG')
        const sony = (await camera.getInfo()).manufacturer === 'Sony'
        const operatingMode = sony
            ? (await camera.getSonyPropertyStates()).find(state => state.code === SONY_OPERATING_MODE_CODE)?.value
            : undefined
        if (operatingMode === 'Playback') throw new Error('The body still reports Playback after the live-view frame that follows a photo')
        report.confirmed('live view after the photo', { jpeg: true, ...(sony && { operatingMode }) })
    },
}
