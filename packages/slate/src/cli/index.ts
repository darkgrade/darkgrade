import {
    closeNodeDiagnostics,
    nodeDiagnostics,
    settingsDirectory,
    sharedSettings,
} from '@contribute/settings'
import { randomUUID } from 'node:crypto'

/** Terminal command behavior shared by the thin darkgrade executable and other Node hosts. */
export async function runDarkgradeCli(argumentsList: readonly string[]): Promise<number> {
    const [group, action, ...args] = argumentsList
    let exitCode = 0
    const usage =
        'darkgrade telemetry <status [--email]|whoami|opt-out|opt-in|delete|login EMAIL|logout|benchmark [--camera VID:PID] [--no-capture] [--no-live] [--json]>'
    try {
        if (
            group !== 'telemetry' ||
            !['status', 'whoami', 'opt-out', 'opt-in', 'delete', 'login', 'logout', 'benchmark'].includes(action ?? '')
        )
            throw new Error(usage)
        const emailStatus = action === 'status' && args.length === 1 && args[0] === '--email'
        if (action !== 'benchmark' && action !== 'login' && args.length && !emailStatus) throw new Error(usage)
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
                    ...(emailStatus && { contact: await (await nodeDiagnostics()).contactStatus() }),
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
                console.log('Confirmation email requested. The submitted address is unverified until you open its link (expires in 2 hours). A verified replacement reassigns this installation’s retained history.')
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
            const { runBenchmarkCommand } = await import('@cli/benchmark')
            exitCode = await runBenchmarkCommand(args)
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : 'Telemetry command failed')
        exitCode = 1
    } finally {
        await closeNodeDiagnostics().catch(() => {})
    }
    return exitCode
}
