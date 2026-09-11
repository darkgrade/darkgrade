import { CanonCamera } from '@camera/canon-camera'
import { Logger } from '@core/logger'
import { USBTransport } from '@transport/usb/usb-transport'

const logger = new Logger({
    expanded: false,
    captureConsole: false,
    renderInTerminal: false,
})
const transport = new USBTransport(logger)
const canonCamera = new CanonCamera(transport, logger)
const argumentsSet = new Set(process.argv.slice(2))
const timeout = setTimeout(() => {
    process.stderr.write('Canon capability probe exceeded 30 seconds\n')
    process.exit(2)
}, 30_000)

try {
    await canonCamera.connect()
    const initialWhiteBalance = await canonCamera.getWhiteBalance().catch(() => undefined)
    const whiteBalanceChoices = canonCamera.getPropertyAllowedValues(canonCamera.registry.properties.CanonWhiteBalance)
    const initialImageFormat = await canonCamera.getImageFormat().catch(() => undefined)
    const imageFormatProperty = canonCamera.listPropertyStates().find(property =>
        ['CanonImageFormat', 'CanonImageFormatSd'].includes(property.name)
    )
    const imageFormatChoices = imageFormatProperty?.allowedValues as
        | Array<{ packed: number; label: string }>
        | undefined
    const report: Record<string, unknown> = {
        ...(!argumentsSet.has('--network-only')
            ? {
                  properties: canonCamera.listPropertyStates(),
                  unknownProperties: canonCamera.listUnknownPropertyStates(),
              }
            : {}),
        networkState: canonCamera.getNetworkState(),
        autofocus: 'not-requested',
        whiteBalanceRoundTrip: 'not-requested',
        imageFormatRoundTrip: 'not-requested',
        movieModeProbe: 'not-requested',
    }

    const forceNetworkMode = process.argv.indexOf('--force-network-mode')
    if (forceNetworkMode >= 0) {
        const value = Number(process.argv[forceNetworkMode + 1])
        if (!Number.isInteger(value)) throw new Error('--force-network-mode requires a uint32 value')
        report.networkModeAttempt = { requested: value, before: canonCamera.getNetworkState() }
        await canonCamera.setNetworkCommunicationMode(value, true)
        report.networkModeAttempt = { ...(report.networkModeAttempt as object), accepted: true, after: canonCamera.getNetworkState() }
    }

    if (argumentsSet.has('--autofocus')) {
        await canonCamera.autofocus()
        report.autofocus = 'completed'
    }

    if (argumentsSet.has('--round-trip-white-balance')) {
        if (!initialWhiteBalance) throw new Error('The attached camera did not report white balance')
        // Older EOS bodies report a current WB value but omit the allowed-values
        // event. Daylight is a documented Canon value and provides a reversible
        // empirical test when that enumeration is absent.
        const alternate =
            whiteBalanceChoices?.find(value => value !== initialWhiteBalance) ||
            (initialWhiteBalance === 'daylight' ? 'auto' : 'daylight')
        try {
            await canonCamera.setWhiteBalance(alternate)
            report.whiteBalanceRoundTrip = { initial: initialWhiteBalance, selected: alternate }
        } finally {
            await canonCamera.setWhiteBalance(initialWhiteBalance)
        }
        report.whiteBalanceRoundTrip = { ...(report.whiteBalanceRoundTrip as object), restored: initialWhiteBalance }
    }

    if (argumentsSet.has('--round-trip-image-format')) {
        if (!initialImageFormat) throw new Error('The attached camera did not report an image format')
        const alternate = imageFormatChoices?.find(value => value.packed !== initialImageFormat.packed)
        if (!alternate) throw new Error('The attached camera did not report an alternate image format')
        try {
            await canonCamera.setImageFormat(alternate.packed)
            report.imageFormatRoundTrip = {
                initial: { packed: initialImageFormat.packed, label: initialImageFormat.label },
                selected: alternate,
            }
        } finally {
            await canonCamera.setImageFormat(initialImageFormat.packed)
        }
        report.imageFormatRoundTrip = {
            ...(report.imageFormatRoundTrip as object),
            restored: { packed: initialImageFormat.packed, label: initialImageFormat.label },
        }
    }

    if (argumentsSet.has('--probe-movie-mode')) {
        try {
            await canonCamera.enterMovieMode()
            await new Promise(resolve => setTimeout(resolve, 1_000))
            report.movieModeProbe = {
                status: 'entered',
                properties: canonCamera.listPropertyStates().filter(property =>
                    ['CanonMovieSize', 'CanonMovieServoAutofocus', 'CanonRecordingDestination'].includes(property.name)
                ),
                rawMovieProperties: canonCamera
                    .listUnknownPropertyStates()
                    .filter(property => [0xd1bb, 0xd1be, 0xd1ca, 0xd1cc, 0xd1cd].includes(property.code)),
            }
        } finally {
            await canonCamera.leaveMovieMode()
        }
        report.movieModeProbe = { ...(report.movieModeProbe as object), restored: 'still-photo-mode' }
    }

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} finally {
    clearTimeout(timeout)
    await canonCamera.disconnect().catch(() => undefined)
}
