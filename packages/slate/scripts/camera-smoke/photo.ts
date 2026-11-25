import { CameraRefusedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import type { SmokeArea, SmokeReport } from '@scripts/camera-smoke/smoke-area'

/** The file kind the bytes say they are: a JPEG starts FF D8, TIFF-based RAW files II* or MM*. */
function fileSignature(data: Uint8Array): string {
    if (data[0] === 0xff && data[1] === 0xd8) return 'JPEG'
    if ((data[0] === 0x49 && data[1] === 0x49) || (data[0] === 0x4d && data[1] === 0x4d)) return 'TIFF-based RAW'
    if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) return 'ISO media (HEIF or CR3)'
    return `unknown (${[...data.slice(0, 4)].map(byte => byte.toString(16).padStart(2, '0')).join(' ')})`
}

/**
 * With the body in a movie mode, takePhoto prepares a still mode itself and puts the movie mode
 * back. The smoke selects an advertised movie mode as setup and restores the original mode.
 */
async function photoFromMovieMode(camera: Camera, report: SmokeReport) {
    const mode = (await camera.getCapabilities()).controls.exposureProgram
    const movie = mode?.allowedValues?.find(value => /^movie/i.test(value))
    if (!mode?.writable || !movie)
        return report.skipped('takePhoto from a movie mode', 'no writable movie mode is advertised')
    await camera.setControl('exposureProgram', movie)
    report.confirmed(`setup: setControl('exposureProgram', ${JSON.stringify(movie)})`, movie)
    try {
        const photo = await camera.takePhoto({ autofocus: false })
        const after = (await camera.getCapabilities()).controls.exposureProgram?.value
        report.confirmed('takePhoto({ autofocus: false }) from a movie mode', {
            name: photo.name,
            sizeBytes: photo.sizeBytes,
            modeAfter: after,
        })
        if (after !== movie) throw new Error(`takePhoto left the camera in ${after}, not ${movie}`)
    } finally {
        const restored = await camera.setControl('exposureProgram', mode.value)
        report.confirmed(`restore: setControl('exposureProgram', ${JSON.stringify(mode.value)})`, restored.value)
    }
}

/**
 * Takes three photos (each adds one file to the card; nothing is deleted or overwritten): one to
 * the card with autofocus, one to the computer without it, whose bytes are checked against the
 * size the camera reported, and one from a movie mode.
 */
export const photoSmoke: SmokeArea = {
    name: 'photo',
    description: 'takePhoto to the card (autofocus), to the computer (no autofocus) and from a movie mode',
    async run(camera, report) {
        try {
            const card = await camera.takePhoto()
            report.confirmed('takePhoto()', { destination: card.destination, mediaId: card.mediaId, name: card.name, sizeBytes: card.sizeBytes })
        } catch (error) {
            // A scene the camera cannot focus on is the camera's answer, not a driver fault.
            if (!(error instanceof CameraRefusedError)) throw error
            report.skipped('takePhoto()', `the camera refused: ${error.message}`)
        }
        const computer = await camera.takePhoto({ autofocus: false, destination: 'computer' })
        if (computer.data.byteLength !== computer.sizeBytes)
            throw new Error(`Received ${computer.data.byteLength} bytes for a ${computer.sizeBytes}-byte photo`)
        report.confirmed("takePhoto({ autofocus: false, destination: 'computer' })", {
            mediaId: computer.mediaId,
            name: computer.name,
            sizeBytes: computer.sizeBytes,
            received: computer.data.byteLength,
            signature: fileSignature(computer.data),
        })
        await photoFromMovieMode(camera, report)
    },
}
