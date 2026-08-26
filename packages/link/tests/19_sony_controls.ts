import { SonyCamera } from '@camera/sony-camera'
import { Logger } from '@core/logger'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { USBTransport } from '@transport/usb/usb-transport'

function option(name: string): string | undefined {
    const index = process.argv.indexOf(name)
    return index >= 0 ? process.argv[index + 1] : undefined
}

function cameraFilter(): { vendorId: number; productId?: number } {
    const requested = option('--camera')
    if (!requested) return { vendorId: VendorIDs.SONY }
    const match = requested.match(/^([0-9a-f]{4}):([0-9a-f]{4})$/i)
    if (!match?.[1] || !match[2]) throw new Error(`Expected --camera VID:PID, received ${requested}`)
    return { vendorId: Number.parseInt(match[1], 16), productId: Number.parseInt(match[2], 16) }
}

const logger = new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
const transport = new USBTransport(logger)
const camera = new SonyCamera(transport, logger)
const watchdog = setTimeout(() => {
    process.stderr.write('Sony control probe exceeded 45 seconds\n')
    process.exit(124)
}, 45_000)

const report: Record<string, unknown> = {}
try {
    await camera.connect({ usb: { filters: [{ ...cameraFilter(), classCode: 0x06, subclassCode: 0x01 }] } })
    const states = await camera.refreshPropertyStates()
    const selectedNames = new Set([
        'WhiteBalance',
        'FocusMode',
        'CompressionSetting',
        'StillFileFormat',
        'JpegQuality',
        'MovieFileFormat',
        'MovieRecordingSetting',
        'MovieRecordingState',
        'SonyImageSize',
        'AspectRatio',
        'ColorTemperature',
        'ZoomPosition',
        'Aperture',
        'ShutterSpeed',
        'Iso',
    ])
    report.properties = states.filter(
        state => selectedNames.has(state.name) || [0xd241, 0xd242, 0xd25b, 0xd25c, 0xd25d, 0xd25e, 0xd25f, 0xd260].includes(state.code)
    )

    if (process.argv.includes('--autofocus')) {
        await camera.autofocus(Number(option('--duration') || 800))
        report.autofocus = 'completed'
    }

    if (process.argv.includes('--round-trip-white-balance')) {
        const initial = await camera.getWhiteBalance()
        const state = states.find(candidate => candidate.name === 'WhiteBalance')
        const alternate = state?.allowedValues?.find(value => value !== initial)
        if (typeof alternate !== 'string') throw new Error('Sony did not advertise an alternate white-balance value')
        try {
            await camera.setWhiteBalance(alternate)
            report.whiteBalanceRoundTrip = { initial, selected: alternate }
        } finally {
            await camera.setWhiteBalance(initial)
        }
        report.whiteBalanceRoundTrip = { ...(report.whiteBalanceRoundTrip as object), restored: initial }
    }

    if (process.argv.includes('--round-trip-focus-mode')) {
        const initial = await camera.getFocusMode()
        const state = states.find(candidate => candidate.name === 'FocusMode')
        const alternate = state?.allowedValues?.find(value => value !== initial)
        if (typeof alternate !== 'string') throw new Error('Sony did not advertise an alternate focus-mode value')
        try {
            await camera.setFocusMode(alternate)
            report.focusModeRoundTrip = { initial, selected: alternate }
        } finally {
            await camera.setFocusMode(initial)
        }
        report.focusModeRoundTrip = { ...(report.focusModeRoundTrip as object), restored: initial }
    }

    if (process.argv.includes('--round-trip-image-format')) {
        const initial = await camera.getImageFormat()
        const state = states.find(candidate => candidate.name === 'StillFileFormat') ?? states.find(candidate => candidate.name === 'CompressionSetting')
        const alternate = state?.allowedValues?.find(value => value !== initial)
        if (typeof alternate !== 'string') throw new Error('Sony did not advertise an alternate image-format value')
        try {
            await camera.setImageFormat(alternate)
            report.imageFormatRoundTrip = { initial, selected: alternate }
        } finally {
            await camera.setImageFormat(initial)
        }
        report.imageFormatRoundTrip = { ...(report.imageFormatRoundTrip as object), restored: initial }
    }

    if (process.argv.includes('--round-trip-movie-format')) {
        const initial = await camera.getMovieFileFormat()
        const state = states.find(candidate => candidate.name === 'MovieFileFormat')
        const alternate = state?.allowedValues?.find(value => value !== initial)
        if (typeof alternate !== 'string') throw new Error('Sony did not advertise an alternate movie-format value')
        try {
            await camera.setMovieFileFormat(alternate)
            report.movieFormatRoundTrip = { initial, selected: alternate }
        } finally {
            await camera.setMovieFileFormat(initial)
        }
        report.movieFormatRoundTrip = { ...(report.movieFormatRoundTrip as object), restored: initial }
    }

    if (process.argv.includes('--round-trip-aspect-ratio')) {
        const initial = await camera.getAspectRatio()
        const state = states.find(candidate => candidate.name === 'AspectRatio')
        const alternate = state?.allowedValues?.find(value => value !== initial)
        if (typeof alternate !== 'string') throw new Error('Sony did not advertise an alternate aspect-ratio value')
        try {
            await camera.setAspectRatio(alternate)
            report.aspectRatioRoundTrip = { initial, selected: alternate }
        } finally {
            await camera.setAspectRatio(initial)
        }
        report.aspectRatioRoundTrip = { ...(report.aspectRatioRoundTrip as object), restored: initial }
    }

    const whiteBalance = option('--white-balance')
    if (whiteBalance) {
        await camera.setWhiteBalance(whiteBalance)
        report.whiteBalance = await camera.getWhiteBalance()
    }

    const focusMode = option('--focus-mode')
    if (focusMode) {
        await camera.setFocusMode(focusMode)
        report.focusMode = await camera.getFocusMode()
    }

    const imageFormat = option('--image-format')
    if (imageFormat) {
        await camera.setImageFormat(imageFormat)
        report.imageFormat = await camera.getImageFormat()
    }

    const imageSize = option('--image-size')
    if (imageSize) {
        await camera.setImageSize(imageSize)
        report.imageSize = await camera.getImageSize()
    }

    const jpegQuality = option('--jpeg-quality')
    if (jpegQuality) {
        await camera.setJpegQuality(jpegQuality)
        report.jpegQuality = await camera.getJpegQuality()
    }

    const movieFormat = option('--movie-format')
    if (movieFormat) {
        await camera.setMovieFileFormat(movieFormat)
        report.movieFormat = await camera.getMovieFileFormat()
    }

    const movieSetting = option('--movie-setting')
    if (movieSetting) {
        await camera.setMovieRecordingSetting(movieSetting)
        report.movieSetting = await camera.getMovieRecordingSetting()
    }

    const aspectRatio = option('--aspect-ratio')
    if (aspectRatio) {
        await camera.setAspectRatio(aspectRatio)
        report.aspectRatio = await camera.getAspectRatio()
    }

    const colorTemperature = option('--color-temperature')
    if (colorTemperature) {
        await camera.setColorTemperature(Number(colorTemperature))
        report.colorTemperature = await camera.getColorTemperature()
    }

    const zoom = option('--zoom')
    if (zoom) {
        if (zoom !== 'wide' && zoom !== 'tele') throw new Error('--zoom must be wide or tele')
        report.zoom = await camera.powerZoom(zoom, Number(option('--pulses') || 1))
    }

    const zoomSetting = option('--zoom-setting')
    if (zoomSetting) {
        await camera.setZoomSetting(zoomSetting)
        report.zoomSetting = await camera.getZoomSetting()
    }

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} finally {
    clearTimeout(watchdog)
    await camera.disconnect().catch(() => transport.disconnect().catch(() => undefined))
}
