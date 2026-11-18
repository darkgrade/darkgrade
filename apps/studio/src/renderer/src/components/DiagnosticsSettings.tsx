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
    Field,
    FieldContent,
    FieldDescription,
    FieldLabel,
    Input,
    Switch,
} from '@kevinschaich/components'
import type { DiagnosticsStatus } from '@shared/ipc'
import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

export function DiagnosticsSettings() {
    const [status, setStatus] = useState<DiagnosticsStatus | null>(null)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [email, setEmail] = useState('')
    useEffect(() => {
        let active = true
        const refresh = async () => {
            try {
                const result = await window.studio.getDiagnosticsStatus()
                if (active && result.ok) setStatus(result.data)
                else if (active && !result.ok) setMessage(result.error)
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
            if (result.ok) setStatus(result.data)
            else setMessage(result.error)
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
            setMessage(
                result.ok
                    ? `${result.data.passed ? '✅ Profile exported' : '⚠️ Partial profile exported'} · ${result.data.checks.filter(check => check.passed).length}/${result.data.checks.length} reads passed. Saved locally; upload follows your sharing setting.`
                    : result.error
            )
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
                        ? 'Check your email to confirm this installation.'
                        : action === 'remove'
                          ? 'Email association removed.'
                          : result.data
                            ? `Verified: ${result.data.email}`
                            : 'No verified email linked.'
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
    return (
        <section className="mt-8 space-y-3 border-t border-foreground/10 pt-5">
            <Field orientation="horizontal">
                <FieldContent>
                    <FieldLabel htmlFor="camera-diagnostics">Share camera diagnostics</FieldLabel>
                    <FieldDescription>
                        {status.configured
                            ? 'Help improve Link and Matrix with camera capabilities and safe numeric settings. No images or raw serial numbers.'
                            : (status.error ?? 'Sharing is off until a collector is configured.')}
                    </FieldDescription>
                </FieldContent>
                <Switch
                    id="camera-diagnostics"
                    checked={status.sharingEnabled ?? status.enabled}
                    disabled={busy || !status.installationId || status.withdrawalPending}
                    onCheckedChange={value => void change('sharing', value)}
                />
            </Field>
            {status.installationId && (
                <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void benchmark()}>
                        Export camera profile
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !status.installationId}
                        onClick={() =>
                            void navigator.clipboard
                                .writeText(status.installationId!)
                                .then(() => setMessage('Diagnostic ID copied.'))
                                .catch(() => setMessage('Could not copy ID.'))
                        }
                    >
                        Copy diagnostic ID
                    </Button>
                    {status.withdrawalPending ? (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void change('retry')}>
                            Retry deletion
                        </Button>
                    ) : (
                        // Deleting what this Mac has shared can't be undone: ask first.
                        <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
                            <AlertDialogTrigger
                                render={
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-destructive hover:text-destructive"
                                        disabled={busy || !status.configured}
                                    />
                                }
                            >
                                Delete cloud data
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
                    )}
                </div>
            )}
            {status.configured && (
                <details className="group">
                    <summary className="flex w-fit list-none items-center gap-1 text-sm [&::-webkit-details-marker]:hidden">
                        <ChevronRight
                            className="size-3.5 text-muted-foreground transition-transform duration-200 group-open:rotate-90"
                            aria-hidden
                        />
                        Link an email (optional)
                    </summary>
                    <form
                        className="mt-2 flex flex-wrap items-center gap-2"
                        onSubmit={event => {
                            event.preventDefault()
                            void contact('request')
                        }}
                    >
                        <label className="sr-only" htmlFor="telemetry-email">
                            Email address
                        </label>
                        <Input
                            id="telemetry-email"
                            type="email"
                            autoComplete="email"
                            required
                            maxLength={254}
                            value={email}
                            onChange={event => setEmail(event.target.value)}
                            placeholder="you@example.com"
                            disabled={busy}
                        />
                        <Button size="sm" type="submit" disabled={busy || !email || status.withdrawalPending}>
                            Send confirmation
                        </Button>
                        <Button
                            size="sm"
                            type="button"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void contact('status')}
                        >
                            Check status
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
                    </form>
                </details>
            )}
            {(message || status.error) && (
                <p role="status" className="text-xs text-muted-foreground">
                    {message || status.error}
                </p>
            )}
        </section>
    )
}
