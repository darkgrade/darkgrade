import { Button, Field, FieldContent, FieldDescription, FieldLabel, Switch } from '@kevinschaich/components'
import type { DiagnosticsStatus } from '@shared/ipc'
import { useEffect, useState } from 'react'

export function DiagnosticsSettings() {
    const [status, setStatus] = useState<DiagnosticsStatus | null>(null)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [email, setEmail] = useState('')
    const [name, setName] = useState('')
    const [credit, setCredit] = useState(false)
    const [confirmDeletion, setConfirmDeletion] = useState(false)
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
        } finally {
            setBusy(false)
            setConfirmDeletion(false)
        }
    }
    const contact = async (action: 'request' | 'status' | 'remove') => {
        setBusy(true)
        setMessage('')
        try {
            const result = await window.studio.diagnosticsContact(action, email, credit ? name : undefined)
            if (!result.ok) setMessage(result.error)
            else if (action === 'request')
                setMessage('Check your email to confirm. Credit appears only after confirmation.')
            else if (action === 'remove') setMessage('Email and public credit removed.')
            else setMessage(result.data ? `Confirmed: ${result.data.email}` : 'No confirmed email.')
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
                    checked={status.enabled}
                    disabled={busy || !status.configured || status.withdrawalPending}
                    onCheckedChange={value => void change('sharing', value)}
                />
            </Field>
            {status.configured && (
                <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Data and optional credit</summary>
                    <div className="mt-3 space-y-3">
                        <p>
                            Command codes, outcomes, timing, model, firmware and driver revision are kept for 90 days.
                            Reviewed patterns can be kept longer to train Matrix. Turning sharing off clears unsent
                            data. Withdraw to remove this installation’s uploaded data and linked patterns.
                        </p>
                        {status.enrolled && !status.withdrawalPending && (
                            <>
                                <label className="block">
                                    Email (optional)
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={event => setEmail(event.target.value)}
                                        className="mt-1 block w-full rounded border border-foreground/20 bg-transparent p-2"
                                    />
                                </label>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={credit}
                                        onChange={event => setCredit(event.target.checked)}
                                    />
                                    Publish contributor credit
                                </label>
                                {credit && (
                                    <label className="block">
                                        Credit name
                                        <input
                                            value={name}
                                            maxLength={80}
                                            onChange={event => setName(event.target.value)}
                                            className="mt-1 block w-full rounded border border-foreground/20 bg-transparent p-2"
                                        />
                                    </label>
                                )}
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={busy || !email || (credit && !name.trim())}
                                        onClick={() => void contact('request')}
                                    >
                                        Send confirmation
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={busy}
                                        onClick={() => void contact('status')}
                                    >
                                        Check email status
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={busy}
                                        onClick={() => void contact('remove')}
                                    >
                                        Remove email
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </details>
            )}
            {status.withdrawalPending ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span>Sharing is off. Deletion is pending.</span>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void change('retry')}>
                        Retry withdrawal
                    </Button>
                </div>
            ) : (
                status.enrolled && (
                    <div className="flex flex-wrap items-center gap-2">
                        {confirmDeletion ? (
                            <>
                                <span className="text-xs">Withdraw this installation’s contributions?</span>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() => void change('withdraw')}
                                >
                                    Confirm withdrawal
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() => setConfirmDeletion(false)}
                                >
                                    Cancel
                                </Button>
                            </>
                        ) : (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDeletion(true)}>
                                Withdraw uploaded data
                            </Button>
                        )}
                    </div>
                )
            )}
            {(message || status.error) && (
                <p role="status" className="text-xs text-muted-foreground">
                    {message || status.error}
                </p>
            )}
        </section>
    )
}
