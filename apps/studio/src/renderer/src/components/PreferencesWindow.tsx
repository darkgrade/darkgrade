import { Switch, Toaster, TooltipProvider } from '@kevinschaich/components'
// Settings takes the main window's tint: importing the tuner's store applies it here and follows its changes.
import '@renderer/components/AppearanceTuner'
import { DiagnosticsSettings } from '@renderer/components/DiagnosticsSettings'
import { CopyableValue, SettingRow, SettingsGroup } from '@renderer/components/SettingsRows'
import type { McpServerStatus, Preferences } from '@shared/ipc'
import { useEffect, useState } from 'react'

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
        <SettingsGroup title="Integrations">
            <SettingRow
                title="Let AI apps control the camera"
                description="An MCP server on this Mac, so assistants like Claude can read the camera, change settings and take shots. Only apps on this Mac can connect."
                htmlFor="mcp-server"
                control={
                    <>
                        {preferences.mcpServerEnabled && !status.error && (
                            <span className="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span
                                    className={`size-1.5 rounded-full ${status.running ? 'bg-live' : 'bg-foreground/30'}`}
                                    aria-hidden
                                />
                                {status.running ? 'Running' : 'Starting…'}
                            </span>
                        )}
                        <Switch id="mcp-server" checked={preferences.mcpServerEnabled} onCheckedChange={onChange} />
                    </>
                }
            >
                {/* A problem gets its own line under the description, not squeezed in beside the switch. */}
                {preferences.mcpServerEnabled && status.error && (
                    <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
                        <span className="size-1.5 rounded-full bg-destructive" aria-hidden />
                        {status.error}
                    </p>
                )}
            </SettingRow>
            {preferences.mcpServerEnabled && (
                <>
                    <SettingRow title="Server address">
                        <CopyableValue label="address" value={url} />
                    </SettingRow>
                    <SettingRow title="Add to Claude Code">
                        <CopyableValue
                            label="command"
                            value={`claude mcp add --transport http darkgrade-studio ${url}`}
                        />
                    </SettingRow>
                </>
            )}
        </SettingsGroup>
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
        <TooltipProvider delay={200}>
            <Toaster>
                <div className="flex h-full flex-col">
                    <header className="flex h-11 shrink-0 items-center justify-center text-[13px] font-semibold [-webkit-app-region:drag]">
                        Settings
                    </header>
                    <main className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-7 overflow-y-auto px-6 pt-3 pb-8">
                        <McpServerSection
                            preferences={preferences}
                            status={status}
                            onChange={enabled => void api.setPreferences({ mcpServerEnabled: enabled })}
                        />
                        <DiagnosticsSettings />
                    </main>
                </div>
            </Toaster>
        </TooltipProvider>
    )
}
