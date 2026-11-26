import { Slider, Switch, ToggleGroup, ToggleGroupItem } from '@kevinschaich/components'
import { InspectorSection } from '@renderer/components/InspectorSection'
import { VisionOverlayControls } from '@renderer/components/VisionOverlays'
import type { PreviewAssistSettings } from '@renderer/gpu/assists'
import { createStore } from '@renderer/lib/external-store'
import { Histogram } from '@renderer/scopes/Histogram'
import { Vectorscope } from '@renderer/scopes/Vectorscope'
import { Waveform } from '@renderer/scopes/Waveform'
import { SCOPE_IDS, type ScopeId } from '@shared/ipc'
import { persisted } from '@renderer/lib/persisted'

const SCOPES: { id: ScopeId; label: string }[] = [
    { id: 'histogram', label: 'Histogram' },
    { id: 'waveform', label: 'Waveform' },
    { id: 'vectorscope', label: 'Vectorscope' },
]

const STORAGE_KEY = 'studio.scope'

function isScopeId(value: unknown): value is ScopeId {
    return SCOPE_IDS.includes(value as ScopeId)
}

const savedScope = persisted<ScopeId>(STORAGE_KEY, saved => (isScopeId(saved) ? saved : undefined), 'histogram')

/** The scope on show; a tool can switch it too (see App), and the choice is remembered. */
export const scopeChoice = createStore<ScopeId>(savedScope.load())

export function chooseScope(next: ScopeId): void {
    scopeChoice.set(next)
    savedScope.save(next)
}

interface ScopesPanelProps {
    /** Live view is running, so the scopes have frames to read. */
    active: boolean
    /** What to say when there is no picture to measure. */
    inactiveMessage: string
    /** Developer Mode shows the vision overlays' switches. */
    developerMode: boolean
    /** Zebras and focus peaking, drawn over the preview by Studio rather than the camera. */
    assists: PreviewAssistSettings
    onAssistsChange: (assists: PreviewAssistSettings) => void
}

interface PreviewAssistProps {
    label: string
    description: string
    enabled: boolean
    onEnabledChange: (enabled: boolean) => void
    value: number
    min: number
    max: number
    format: (value: number) => string
    onValueChange: (value: number) => void
}

/** A switch for one preview assist, with its slider underneath while it is on. */
function PreviewAssist(props: PreviewAssistProps): React.JSX.Element {
    return (
        <div className="flex flex-col gap-1">
            <label className="flex items-center justify-between gap-2 leading-none" title={props.description}>
                <span className="text-muted-foreground">
                    {props.label}
                    {props.enabled && <span className="text-[11px] tabular-nums"> · {props.format(props.value)}</span>}
                </span>
                <Switch checked={props.enabled} onCheckedChange={props.onEnabledChange} />
            </label>
            {props.enabled && (
                <Slider
                    className="pb-1"
                    min={props.min}
                    max={props.max}
                    value={props.value}
                    onValueChange={value => props.onValueChange(Array.isArray(value) ? value[0] : value)}
                    aria-label={props.label}
                />
            )}
        </div>
    )
}

/** One scope of the live feed at a time, chosen like Resolve's scope menu and remembered. */
export function ScopesPanel({
    active,
    inactiveMessage,
    developerMode,
    assists,
    onAssistsChange,
}: ScopesPanelProps): React.JSX.Element {
    const scope = scopeChoice.use()
    // No picture, no scopes: a line saying so, not empty graphs and switches with nothing to act on.
    if (!active)
        return (
            <InspectorSection title="Scopes" collapsible defaultOpen>
                <p className="text-muted-foreground">{inactiveMessage}</p>
            </InspectorSection>
        )

    return (
        <InspectorSection title="Scopes" collapsible defaultOpen>
            <ToggleGroup
                className="w-full rounded-lg bg-foreground/6 p-0.5"
                spacing={0}
                size="sm"
                value={[scope]}
                onValueChange={value => {
                    const next = value[0]
                    if (isScopeId(next)) chooseScope(next)
                }}
                aria-label="Scope"
            >
                {SCOPES.map(option => (
                    <ToggleGroupItem
                        key={option.id}
                        value={option.id}
                        className="min-w-0 flex-1 rounded-md! px-0.5! text-[12px]! text-muted-foreground hover:bg-transparent hover:text-foreground data-[pressed]:bg-foreground/12 data-[pressed]:text-foreground"
                    >
                        {option.label}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
            {scope === 'histogram' && <Histogram active={active} />}
            {scope === 'waveform' && <Waveform active={active} />}
            {scope === 'vectorscope' && (
                <div className="mx-auto w-52">
                    <Vectorscope active={active} />
                </div>
            )}
            <div className="flex flex-col gap-1.75">
                <PreviewAssist
                    label="Zebras"
                    description="Stripes over areas at or above this brightness"
                    enabled={assists.zebras}
                    onEnabledChange={zebras => onAssistsChange({ ...assists, zebras })}
                    value={assists.zebraLevelPercent}
                    min={70}
                    max={100}
                    format={value => `${value}%`}
                    onValueChange={zebraLevelPercent => onAssistsChange({ ...assists, zebraLevelPercent })}
                />
                <PreviewAssist
                    label="Focus peaking"
                    description="Outlines sharp edges in red; higher marks softer edges too"
                    enabled={assists.focusPeaking}
                    onEnabledChange={focusPeaking => onAssistsChange({ ...assists, focusPeaking })}
                    value={assists.peakingSensitivity}
                    min={1}
                    max={100}
                    format={value => `${value}`}
                    onValueChange={peakingSensitivity => onAssistsChange({ ...assists, peakingSensitivity })}
                />
            </div>
            {developerMode && <VisionOverlayControls />}
        </InspectorSection>
    )
}
