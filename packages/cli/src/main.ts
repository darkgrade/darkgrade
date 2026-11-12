#!/usr/bin/env node
import {
    closeNodeDiagnostics,
    nodeDiagnostics,
    settingsDirectory,
    sharedSettings,
} from '@darkgrade/contribute/settings'
import { randomUUID } from 'node:crypto'

const [group, action, ...args] = process.argv.slice(2)
const usage =
    'darkgrade telemetry <status|whoami|opt-out|opt-in|delete|login EMAIL|logout|benchmark --camera VID:PID [--capture] [--live]>'
try {
    if (
        group !== 'telemetry' ||
        !['status', 'whoami', 'opt-out', 'opt-in', 'delete', 'login', 'logout', 'benchmark'].includes(action ?? '')
    )
        throw new Error(usage)
    if (action !== 'benchmark' && action !== 'login' && args.length) throw new Error(usage)
    if (
        action === 'login' &&
        (args.length !== 1 || args[0].length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(args[0]))
    )
        throw new Error('Use darkgrade telemetry login EMAIL')
    const store = sharedSettings()
    const saved = await store.read()
    if (!saved) throw new Error('Telemetry settings unavailable')
    if (action === 'whoami') console.log(saved.installationId ?? saved.installKey?.slice(4, 40))
    else if (action === 'status')
        console.log(
            JSON.stringify({
                installationId: saved.installationId ?? saved.installKey?.slice(4, 40),
                sharing: saved.enabled,
                effectiveSharing:
                    saved.enabled &&
                    !saved.withdrawalPending &&
                    process.env.DARKGRADE_CONTRIBUTIONS !== '0' &&
                    process.env.DO_NOT_TRACK !== '1',
                configured: true,
                deletionPending: saved.withdrawalPending,
                settings: settingsDirectory(),
            })
        )
    else if (action === 'opt-out' || action === 'opt-in') {
        if (action === 'opt-in' && saved.withdrawalPending)
            throw new Error('Finish pending deletion before enabling sharing')
        await store.write({
            ...saved,
            enabled: action === 'opt-in',
            ...(action === 'opt-in' && !saved.installKey && !saved.enrollmentKey
                ? { installationId: randomUUID() }
                : {}),
        })
        console.log(action === 'opt-out' ? 'Sharing disabled.' : 'Sharing enabled.')
    } else if (action === 'login' || action === 'logout') {
        const client = await nodeDiagnostics()
        if (action === 'login') {
            await client.requestContact(args[0])
            console.log('Confirmation email requested. Open its link to finish linking this installation.')
        } else {
            if (saved.installKey) await client.removeContact()
            console.log('Email association removed. Your sharing preference is unchanged.')
        }
    } else if (action === 'delete') {
        // Disable locally before touching network, including when the service is not configured.
        await store.write({
            ...saved,
            enabled: false,
            withdrawalPending: !!saved.installKey || !!saved.registrationPending,
        })
        if (saved.installKey || saved.registrationPending) {
            const client = await nodeDiagnostics()
            await client.retryWithdrawal()
            console.log(
                client.status().withdrawalPending
                    ? 'Sharing is off. Deletion is pending.'
                    : 'Sharing is off. Cloud data deleted.'
            )
        } else console.log('Sharing is off. No cloud enrollment exists.')
    } else if (action === 'benchmark') {
        const cameraIndex = args.indexOf('--camera')
        const cameraId = args[cameraIndex + 1]
        if (
            cameraIndex < 0 ||
            !/^[a-f0-9]{4}:[a-f0-9]{4}$/i.test(cameraId ?? '') ||
            args.some(
                (value, index) => index !== cameraIndex + 1 && !['--camera', '--capture', '--live'].includes(value)
            )
        )
            throw new Error(usage)
        // Importing the CLI's preference commands never loads USB or opens a camera.
        const { Camera, runCameraBenchmark } = await import('@darkgrade/link')
        const [vendorId, productId] = cameraId.split(':').map(value => parseInt(value, 16))
        const camera = new Camera({
            device: { usb: { filters: [{ vendorId, productId }] } },
            logger: { renderInTerminal: false, captureConsole: false },
            transactionPolicy: { timeoutMilliseconds: 10_000, deviceBusyRetries: 1 },
        })
        let timedOut = false
        const deadline = setTimeout(() => {
            timedOut = true
            process.exitCode = 124
            console.error('Benchmark exceeded its deadline; disconnecting the camera')
            setTimeout(() => process.exit(124), 15_000).unref()
            void camera
                .disconnect()
                .catch(() => {})
                .finally(() => process.exit(124))
        }, 120_000)
        try {
            await camera.connect()
            const result = await runCameraBenchmark(camera, {
                capture: args.includes('--capture'),
                live: args.includes('--live'),
            })
            if (timedOut) throw new Error('Benchmark timed out')
            const upload = await (await nodeDiagnostics()).flush()
            console.log(JSON.stringify({ ...result, upload }))
            if (!result.passed) process.exitCode = 1
        } finally {
            try {
                await camera.disconnect()
            } finally {
                clearTimeout(deadline)
            }
        }
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : 'Telemetry command failed')
    process.exitCode ||= 1
} finally {
    await closeNodeDiagnostics().catch(() => {})
}
