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
    toast,
} from '@kevinschaich/components'
import type { DiagnosticsStatus } from '@shared/ipc'
import { ChevronRight } from 'lucide-react'
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
            if (action === 'sharing') setMessage(value ? 'Sharing is on.' : 'Sharing is off.')
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
    return (
        <section className="mt-8 space-y-3 border-t border-border pt-5">
            <Field orientation="horizontal">
                <FieldContent>
                    <FieldLabel htmlFor="camera-diagnostics">Share camera diagnostics</FieldLabel>
                    <FieldDescription>
                        {!status.configured
                            ? (status.error ?? 'Sharing is off until a collector is configured.')
                            : status.withdrawalPending
                              ? "Deleting what this Mac shared. Sharing can be turned back on once that's done."
                              : 'Help improve Link and Matrix with camera capabilities and safe numeric settings. No images or raw serial numbers.'}
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
                            disabled={busy || !status.enabled}
                        />
                        <Button size="sm" type="submit" disabled={busy || !email || !status.enabled}>
                            Send confirmation
                        </Button>
                        <Button
                            size="sm"
                            type="button"
                            variant="ghost"
                            disabled={busy || !status.enrolled}
                            onClick={() => void contact('status')}
                        >
                            Check status
                        </Button>
                        <Button
                            size="sm"
                            type="button"
                            variant="ghost"
                            disabled={busy || !status.enrolled}
                            onClick={() => void contact('remove')}
                        >
                            Unlink
                        </Button>
                    </form>
                    {!status.enabled && (
                        <p className="mt-2 text-xs text-muted-foreground">Turn on sharing to link an email.</p>
                    )}
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
