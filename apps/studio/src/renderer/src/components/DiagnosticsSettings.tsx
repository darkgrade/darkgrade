import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
    Button,
    Input,
    Switch,
    toast,
} from '@kevinschaich/components'
import { CopyableValue, SETTING_BUTTON_CLASS, SettingRow, SettingsGroup } from '@renderer/components/SettingsRows'
import type { DiagnosticsStatus } from '@shared/ipc'
import { useEffect, useRef, useState } from 'react'

/** Paths read better relative to the home folder, as Finder shows them. */
const shortPath = (path: string): string => path.replace(/^\/Users\/[^/]+/, '~')

export function DiagnosticsSettings() {
    const [status, setStatus] = useState<DiagnosticsStatus | null>(null)
    const wasDeleting = useRef(false)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [email, setEmail] = useState('')
    useEffect(() => {
        let active = true
        const refresh = async () => {
            try {
                const result = await window.studio.getDiagnosticsStatus()
                if (active && result.ok) {
                    // A deletion finishes on its own after the first request; say so when it does.
                    if (wasDeleting.current && !result.data.withdrawalPending)
                        setMessage("Deleted from Darkgrade's servers. You can turn sharing back on.")
                    wasDeleting.current = result.data.withdrawalPending
                    setStatus(result.data)
                } else if (active && !result.ok) setMessage(result.error)
            } catch {
                if (active) setMessage('Telemetry settings could not be loaded.')
            }
        }
        void refresh()
        const timer = setInterval(() => void refresh(), 5000)
        return () => {
            active = false
            clearInterval(timer)
        }
    }, [])
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    const change = async (action: 'sharing' | 'withdraw' | 'retry', value?: boolean) => {
        setBusy(true)
        setMessage('')
        try {
            const result = await window.studio.changeDiagnostics(action, value)
            if (!result.ok) return setMessage(result.error)
            setStatus(result.data)
            wasDeleting.current = result.data.withdrawalPending
            if (action === 'withdraw' || action === 'retry')
                setMessage(
                    result.data.withdrawalPending
                        ? "Deleting what this Mac shared from Darkgrade's servers. It finishes on its own; this updates when it's done."
                        : "Deleted from Darkgrade's servers. You can turn sharing back on."
                )
        } catch {
            setMessage('Could not update telemetry. Try again.')
        } finally {
            setBusy(false)
        }
    }
    const benchmark = async () => {
        setBusy(true)
        setMessage('Reading camera profile… This can take up to three minutes.')
        try {
            const result = await window.studio.diagnosticsBenchmark()
            if (!result.ok) return setMessage(result.error)
            const { passed, checks, path } = result.data
            setMessage('')
            toast.add({
                title: passed ? 'Camera profile exported' : 'Partial camera profile exported',
                description: `${checks.filter(check => check.passed).length} of ${checks.length} reads passed · ${shortPath(path)}`,
                actionProps: { children: 'Show in Finder', onClick: () => void window.studio.revealPath(path) },
            })
        } catch {
            setMessage('Camera check failed. Try again.')
        } finally {
            setBusy(false)
        }
    }
    const contact = async (action: 'request' | 'remove' | 'status') => {
        setBusy(true)
        try {
            const result = await window.studio.diagnosticsContact(action, action === 'request' ? email : undefined)
            setMessage(
                result.ok
                    ? action === 'request'
                        ? `Sent to ${email}. Open the link in that email to confirm this Mac.`
                        : action === 'remove'
                          ? 'Email unlinked from this Mac.'
                          : result.data
                            ? `Linked and confirmed: ${result.data.email}`
                            : 'No email is linked to this Mac yet.'
                    : result.error
            )
            if (result.ok && action !== 'status') setEmail('')
        } catch {
            setMessage('Email settings could not be updated. Try again.')
        } finally {
            setBusy(false)
        }
    }
    if (!status) return message ? <p role="status">{message}</p> : null
    const footer = message || status.error
    return (
        <SettingsGroup title="Diagnostics" footer={footer && <span role="status">{footer}</span>}>
            <SettingRow
                title="Share camera diagnostics"
                htmlFor="camera-diagnostics"
                description={
                    !status.configured
                        ? (status.error ?? 'Sharing is off until a collector is configured.')
                        : status.withdrawalPending
                          ? "Deleting what this Mac shared. Sharing can be turned back on once that's done."
                          : 'Camera capabilities and numeric settings, to improve Link and Matrix. No images or raw serial numbers.'
                }
                control={
                    <Switch
                        id="camera-diagnostics"
                        checked={status.sharingEnabled ?? status.enabled}
                        disabled={busy || !status.installationId || status.withdrawalPending}
                        onCheckedChange={value => void change('sharing', value)}
                    />
                }
            />
            {status.installationId && (
                <>
                    <SettingRow
                        title="Camera profile"
                        description="Reads what the connected camera reports and saves it to a file."
                        control={
                            <Button
                                size="sm"
                                variant="secondary"
                                className={SETTING_BUTTON_CLASS}
                                disabled={busy}
                                onClick={() => void benchmark()}
                            >
                                Export…
                            </Button>
                        }
                    />
                    <SettingRow
                        title="Diagnostic ID"
                        description="Quote it when you report a problem."
                        control={
                            <div className="w-44">
                                <CopyableValue label="diagnostic ID" value={status.installationId} />
                            </div>
                        }
                    />
                </>
            )}
            {status.configured && (
                <SettingRow
                    title="Email"
                    htmlFor="telemetry-email"
                    description={
                        status.enabled
                            ? 'Optional. A link sent to it confirms this Mac.'
                            : 'Optional. Turn on sharing to link an email.'
                    }
                >
                    <form
                        className="flex items-center gap-2"
                        onSubmit={event => {
                            event.preventDefault()
                            void contact('request')
                        }}
                    >
                        <Input
                            id="telemetry-email"
                            className="h-7 min-w-0 flex-1 border-0 text-[13px] bg-foreground/5 dark:bg-foreground/5"
                            type="email"
                            autoComplete="email"
                            required
                            maxLength={254}
                            value={email}
                            onChange={event => setEmail(event.target.value)}
                            placeholder="you@example.com"
                            disabled={busy || !status.enabled}
                        />
                        <Button
                            size="sm"
                            variant="secondary"
                            className={SETTING_BUTTON_CLASS}
                            type="submit"
                            disabled={busy || !email || !status.enabled}
                        >
                            Send link
                        </Button>
                        {status.enrolled && (
                            <>
                                <Button
                                    size="sm"
                                    type="button"
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() => void contact('status')}
                                >
                                    Check
                                </Button>
                                <Button
                                    size="sm"
                                    type="button"
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() => void contact('remove')}
                                >
                                    Unlink
                                </Button>
                            </>
                        )}
                    </form>
                </SettingRow>
            )}
            {status.installationId && (
                <SettingRow
                    title="Delete shared data"
                    description="Removes everything this Mac has shared from Darkgrade's servers."
                    control={
                        status.withdrawalPending ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                className={SETTING_BUTTON_CLASS}
                                disabled={busy}
                                onClick={() => void change('retry')}
                            >
                                Retry deletion
                            </Button>
                        ) : (
                            // Deleting what this Mac has shared can't be undone: ask first.
                            <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
                                <AlertDialogTrigger
                                    render={
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            className={`${SETTING_BUTTON_CLASS} text-destructive hover:text-destructive`}
                                            disabled={busy || !status.configured}
                                        />
                                    }
                                >
                                    Delete…
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Delete this Mac's camera diagnostics?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Everything this installation has shared is removed from Darkgrade's servers.
                                            This can't be undone.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction
                                            variant="destructive"
                                            onClick={() => {
                                                setConfirmingDelete(false)
                                                void change('withdraw')
                                            }}
                                        >
                                            Delete
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )
                    }
                />
            )}
        </SettingsGroup>
    )
}
