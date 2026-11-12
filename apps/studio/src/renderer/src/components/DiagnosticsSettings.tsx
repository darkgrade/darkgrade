import { Button, Field, FieldContent, FieldDescription, FieldLabel, Switch } from '@kevinschaich/components'
import type { DiagnosticsStatus } from '@shared/ipc'
import { useEffect, useState } from 'react'

export function DiagnosticsSettings() {
    const [status, setStatus] = useState<DiagnosticsStatus | null>(null)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    useEffect(() => {
        let active = true
        const refresh = async () => {
            const result = await window.studio.getDiagnosticsStatus()
            if (active && result.ok) setStatus(result.data)
        }
        void refresh()
        const timer = setInterval(() => void refresh(), 5000)
        return () => {
            active = false
            clearInterval(timer)
        }
    }, [])
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
        setMessage('Checking camera…')
        try {
            const result = await window.studio.diagnosticsBenchmark()
            setMessage(
                result.ok
                    ? result.data.checks.map(check => `${check.passed ? '✅' : '❌'} ${check.name}`).join(' · ')
                    : result.error
            )
        } catch {
            setMessage('Camera check failed. Try again.')
        } finally {
            setBusy(false)
        }
    }
    if (!status) return null
    return (
        <section className="mt-8 space-y-3 border-t border-foreground/10 pt-5">
            <Field orientation="horizontal">
                <FieldContent>
                    <FieldLabel htmlFor="camera-diagnostics">Share camera diagnostics</FieldLabel>
                    <FieldDescription>
                        {status.configured
                            ? 'Help improve Link and Matrix. No images, serial numbers or command parameters.'
                            : (status.error ?? 'Sharing is off until a collector is configured.')}
                    </FieldDescription>
                </FieldContent>
                <Switch
                    id="camera-diagnostics"
                    checked={status.sharingEnabled ?? status.enabled}
                    disabled={busy || !status.configured || status.withdrawalPending}
                    onCheckedChange={value => void change('sharing', value)}
                />
            </Field>
            {status.configured && (
                <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void benchmark()}>
                        Check camera
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
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
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void change(status.withdrawalPending ? 'retry' : 'withdraw')}
                    >
                        {status.withdrawalPending ? 'Retry deletion' : 'Delete cloud data'}
                    </Button>
                </div>
            )}
            {(message || status.error) && (
                <p role="status" className="text-xs text-muted-foreground">
                    {message || status.error}
                </p>
            )}
        </section>
    )
}
