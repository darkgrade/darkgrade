import type { SmokeArea } from '@scripts/camera-smoke/smoke-area'

const EVENT_WAIT_MILLISECONDS = 15_000

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
    },
}
