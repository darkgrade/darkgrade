import { CanonCamera } from '@camera/canon-camera'
import { Logger } from '@core/logger'
import { USBTransport } from '@transport/usb/usb-transport'
import { writeFile } from 'node:fs/promises'

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
    const imageFormatProperty = canonCamera
        .listPropertyStates()
        .find(property => ['CanonImageFormat', 'CanonImageFormatSd'].includes(property.name))
    const imageFormatChoices = imageFormatProperty?.allowedValues as
        Array<{ packed: number; label: string }> | undefined
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

    for (const [flag, property, read, write] of [
        [
            '--round-trip-iso',
            canonCamera.registry.properties.CanonIso,
            () => canonCamera.getIso(),
            (value: string) => canonCamera.setIso(value),
        ],
        [
            '--round-trip-aperture',
            canonCamera.registry.properties.CanonAperture,
            () => canonCamera.getAperture(),
            (value: string) => canonCamera.setAperture(value),
        ],
        [
            '--round-trip-shutter-speed',
            canonCamera.registry.properties.CanonShutterSpeed,
            () => canonCamera.getShutterSpeed(),
            (value: string) => canonCamera.setShutterSpeed(value),
        ],
    ] as const) {
        if (!argumentsSet.has(flag)) continue
        const original = await read()
        const valueIndex = process.argv.indexOf('--value')
        const requested = valueIndex >= 0 ? process.argv[valueIndex + 1] : undefined
        const alternate = canonCamera
            .getPropertyAllowedValues(property)
            ?.find(value => value !== original && (!requested || value === requested))
        if (alternate === undefined) throw new Error(`${property.name} has no advertised alternate`)
        try {
            await write(alternate)
            const selected = await read()
            if (selected !== alternate) throw new Error(`${property.name} did not apply ${alternate}`)
            report[property.name] = { original, selected }
        } finally {
            await write(original)
        }
        const restored = await read()
        if (restored !== original) throw new Error(`${property.name} was not restored`)
        report[property.name] = { ...(report[property.name] as object), restored }
    }

    const forceNetworkMode = process.argv.indexOf('--force-network-mode')
    if (argumentsSet.has('--live-view')) {
        const originalOutput = await canonCamera.getHdmiLiveViewMode()
        try {
            const frame = await canonCamera.captureViewfinderFrame()
            const outputIndex = process.argv.indexOf('--output')
            const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : '/tmp/canon-live-view.jpg'
            if (!output) throw new Error('--output requires a file path')
            await writeFile(output, frame.image)
            report.liveView = {
                bytes: frame.image.length,
                jpegStart: [...frame.image.subarray(0, 2)],
                jpegEnd: [...frame.image.subarray(-2)],
                output,
                segments: frame.segments.map(segment => ({
                    type: segment.type,
                    bytes: segment.data.length,
                    previewHex: Buffer.from(segment.data.subarray(0, 64)).toString('hex'),
                })),
                originalOutput,
            }
        } finally {
            await canonCamera.stopLiveView()
        }
        const restoredOutput = await canonCamera.getHdmiLiveViewMode()
        if (restoredOutput !== originalOutput) throw new Error('Live-view output was not restored')
        report.liveView = { ...(report.liveView as object), restoredOutput }
    }

    if (argumentsSet.has('--round-trip-color-temperature')) {
        const original = await canonCamera.getColorTemperature()
        const alternate = canonCamera
            .getPropertyAllowedValues(canonCamera.registry.properties.CanonColorTemperature)
            ?.find(value => value !== original)
        if (alternate === undefined) throw new Error('No alternate color temperature was advertised')
        try {
            await canonCamera.setColorTemperature(alternate)
            report.colorTemperatureRoundTrip = { original, selected: await canonCamera.getColorTemperature() }
        } finally {
            await canonCamera.setColorTemperature(original)
        }
        report.colorTemperatureRoundTrip = {
            ...(report.colorTemperatureRoundTrip as object),
            restored: await canonCamera.getColorTemperature(),
        }
    }

    if (argumentsSet.has('--round-trip-live-view-af')) {
        const original = await canonCamera.getLiveViewAutofocusMode()
        const alternate = canonCamera
            .getPropertyAllowedValues(canonCamera.registry.properties.CanonLiveViewAutofocusMode)
            ?.find(value => value !== original)
        if (alternate === undefined) throw new Error('No alternate live-view AF mode was advertised')
        try {
            await canonCamera.setLiveViewAutofocusMode(alternate)
            report.liveViewAfRoundTrip = { original, selected: await canonCamera.getLiveViewAutofocusMode() }
        } finally {
            await canonCamera.setLiveViewAutofocusMode(original)
        }
        report.liveViewAfRoundTrip = {
            ...(report.liveViewAfRoundTrip as object),
            restored: await canonCamera.getLiveViewAutofocusMode(),
        }
    }

    if (argumentsSet.has('--round-trip-live-view-zoom')) {
        const before = await canonCamera.captureViewfinderFrame()
        const zoomState = before.segments.find(segment => segment.type === 4)?.data
        if (!zoomState || zoomState.length !== 4) throw new Error('Camera did not publish live-view zoom state')
        const originalZoom = new DataView(zoomState.buffer, zoomState.byteOffset, 4).getUint32(0, true)
        if (![1, 5, 6, 10, 15].includes(originalZoom))
            throw new Error(`Cannot restore unknown live-view zoom ${originalZoom}`)
        try {
            await canonCamera.setLiveViewZoom(5)
            const zoomed = await canonCamera.captureViewfinderFrame()
            const changedState = zoomed.segments.find(segment => segment.type === 4)?.data
            const changedZoom =
                changedState?.length === 4
                    ? new DataView(changedState.buffer, changedState.byteOffset, 4).getUint32(0, true)
                    : undefined
            if (changedZoom !== 5) throw new Error(`Camera did not apply live-view zoom: ${changedZoom}`)
            await writeFile('/tmp/canon-live-view-zoom.jpg', zoomed.image)
            report.liveViewZoom = {
                originalZoom,
                changedZoom,
                baselineBytes: before.image.length,
                zoomedBytes: zoomed.image.length,
                segments: zoomed.segments.map(segment => ({
                    type: segment.type,
                    bytes: segment.data.length,
                    previewHex: Buffer.from(segment.data.subarray(0, 64)).toString('hex'),
                })),
            }
        } finally {
            await canonCamera.setLiveViewZoom(originalZoom as 1 | 5 | 6 | 10 | 15)
            await canonCamera.stopLiveView()
        }
    }

    if (forceNetworkMode >= 0) {
        const value = Number(process.argv[forceNetworkMode + 1])
        if (!Number.isInteger(value)) throw new Error('--force-network-mode requires a uint32 value')
        report.networkModeAttempt = { requested: value, before: canonCamera.getNetworkState() }
        await canonCamera.setNetworkCommunicationMode(value, true)
        report.networkModeAttempt = {
            ...(report.networkModeAttempt as object),
            accepted: true,
            after: canonCamera.getNetworkState(),
        }
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
            if ((await canonCamera.getWhiteBalance()) !== alternate)
                throw new Error('Camera did not apply white balance')
            report.whiteBalanceRoundTrip = { initial: initialWhiteBalance, selected: alternate }
        } finally {
            await canonCamera.setWhiteBalance(initialWhiteBalance)
        }
        if ((await canonCamera.getWhiteBalance()) !== initialWhiteBalance)
            throw new Error('White balance was not restored')
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
                properties: canonCamera
                    .listPropertyStates()
                    .filter(property =>
                        ['CanonMovieSize', 'CanonMovieServoAutofocus', 'CanonRecordingDestination'].includes(
                            property.name
                        )
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
