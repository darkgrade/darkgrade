import {
    Button,
    Field,
    FieldContent,
    FieldDescription,
    FieldLabel,
    Switch,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@kevinschaich/components'
import { DiagnosticsSettings } from '@renderer/components/DiagnosticsSettings'
import type { McpServerStatus, Preferences } from '@shared/ipc'
import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

/** A value with a copy button that confirms with a check for a moment. */
function CopyableValue({ label, value }: { label: string; value: string }): React.JSX.Element {
    const [copied, setCopied] = useState(false)
    return (
        <div className="flex items-center gap-2 rounded-md bg-foreground/5 py-1 pr-1 pl-3">
            <code className="selectable min-w-0 flex-1 truncate font-mono text-xs text-foreground/85">{value}</code>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Copy ${label}`}
                            onClick={() => {
                                void navigator.clipboard.writeText(value)
                                setCopied(true)
                                setTimeout(() => setCopied(false), 1400)
                            }}
                        />
                    }
                >
                    {copied ? <Check className="text-live" /> : <Copy />}
                </TooltipTrigger>
                <TooltipContent>{copied ? 'Copied' : `Copy ${label}`}</TooltipContent>
            </Tooltip>
        </div>
    )
}

function McpServerSection({
    preferences,
    status,
    onChange,
}: {
    preferences: Preferences
    status: McpServerStatus
    onChange: (enabled: boolean) => void
}): React.JSX.Element {
    const url = status.url ?? `http://127.0.0.1:${preferences.mcpServerPort}/mcp`
    return (
        <section className="space-y-4">
            <Field orientation="horizontal">
                <FieldContent>
                    <FieldLabel htmlFor="mcp-server">Let AI apps control the camera</FieldLabel>
                    <FieldDescription>
                        Runs an MCP server on this Mac so assistants like Claude can read the camera, change settings,
                        measure the picture and take shots. Only apps on this Mac can connect.
                    </FieldDescription>
                </FieldContent>
                <Switch id="mcp-server" checked={preferences.mcpServerEnabled} onCheckedChange={onChange} />
            </Field>
            {preferences.mcpServerEnabled && (
                <div className="space-y-3 pl-0.5">
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span
                            className={`size-1.5 rounded-full ${status.running ? 'bg-live' : status.error ? 'bg-destructive' : 'bg-foreground/30'}`}
                            aria-hidden
                        />
                        {status.running ? 'Running' : status.error ? status.error : 'Starting…'}
                    </p>
                    <div className="space-y-1.5">
                        <p className="text-xs text-muted-foreground">Server address</p>
                        <CopyableValue label="address" value={url} />
                    </div>
                    <div className="space-y-1.5">
                        <p className="text-xs text-muted-foreground">Add to Claude Code</p>
                        <CopyableValue
                            label="command"
                            value={`claude mcp add --transport http darkgrade-studio ${url}`}
                        />
                    </div>
                </div>
            )}
        </section>
    )
}

/** Studio's Settings window (⌘,). */
export function PreferencesWindow(): React.JSX.Element | null {
    const api = window.studio
    const [preferences, setPreferences] = useState<Preferences | null>(null)
    const [status, setStatus] = useState<McpServerStatus>({ running: false, url: null, error: null })

    useEffect(() => {
        void api.getPreferences().then(result => result.ok && setPreferences(result.data))
        void api.getMcpServerStatus().then(result => result.ok && setStatus(result.data))
        const unsubscribePreferences = api.onPreferences(setPreferences)
        const unsubscribeStatus = api.onMcpServerStatus(setStatus)
        return () => {
            unsubscribePreferences()
            unsubscribeStatus()
        }
    }, [api])

    if (!preferences) return null
    return (
        <TooltipProvider delay={400}>
            <div className="flex h-full flex-col bg-canvas">
                <header className="flex h-12 shrink-0 items-center justify-center text-sm font-medium [-webkit-app-region:drag]">
                    Settings
                </header>
                <main className="min-h-0 flex-1 overflow-y-auto px-8 pt-4 pb-8">
                    <h2 className="mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        Integrations
                    </h2>
                    <McpServerSection
                        preferences={preferences}
                        status={status}
                        onChange={enabled => void api.setPreferences({ mcpServerEnabled: enabled })}
                    />
                    <DiagnosticsSettings />
                </main>
            </div>
        </TooltipProvider>
    )
}
