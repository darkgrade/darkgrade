import { Slider, Switch, ToggleGroup, ToggleGroupItem } from '@kevinschaich/components'
import { InspectorSection } from '@renderer/components/InspectorSection'
import { Histogram } from '@renderer/scopes/Histogram'
import type { PreviewAssistSettings } from '@renderer/scopes/PreviewAssists'
import { Vectorscope } from '@renderer/scopes/Vectorscope'
import { Waveform } from '@renderer/scopes/Waveform'
import { useState } from 'react'

const SCOPES = [
    { id: 'histogram', label: 'Histogram' },
    { id: 'waveform', label: 'Waveform' },
    { id: 'vectorscope', label: 'Vectorscope' },
] as const

type ScopeId = (typeof SCOPES)[number]['id']

const STORAGE_KEY = 'studio.scope'

function isScopeId(value: unknown): value is ScopeId {
    return SCOPES.some(scope => scope.id === value)
}

function readSavedScope(): ScopeId {
    try {
        const saved = localStorage.getItem(STORAGE_KEY)
        return isScopeId(saved) ? saved : 'histogram'
    } catch {
        return 'histogram'
    }
}

interface ScopesPanelProps {
    /** The latest live-view frame; the chosen scope follows it frame by frame. */
    frameUrl: string | null
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
        <div className="flex flex-col gap-1.5">
            <label className="flex h-8 items-center justify-between gap-2" title={props.description}>
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
export function ScopesPanel({ frameUrl, assists, onAssistsChange }: ScopesPanelProps): React.JSX.Element {
    const [scope, setScope] = useState<ScopeId>(readSavedScope)

    const choose = (next: ScopeId): void => {
        setScope(next)
        try {
            localStorage.setItem(STORAGE_KEY, next)
        } catch {
            // The choice still applies for this session.
        }
    }

    return (
        <InspectorSection title="Scopes" collapsible defaultOpen>
            <ToggleGroup
                className="w-full rounded-lg bg-foreground/6 p-0.5"
                spacing={0}
                size="sm"
                value={[scope]}
                onValueChange={value => {
                    const next = value[0]
                    if (isScopeId(next)) choose(next)
                }}
                aria-label="Scope"
            >
                {SCOPES.map(option => (
                    <ToggleGroupItem
                        key={option.id}
                        value={option.id}
                        className="flex-1 rounded-md! text-muted-foreground hover:bg-transparent hover:text-foreground data-[pressed]:bg-foreground/12 data-[pressed]:text-foreground"
                    >
                        {option.label}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
            {scope === 'histogram' && <Histogram frameUrl={frameUrl} />}
            {scope === 'waveform' && <Waveform frameUrl={frameUrl} />}
            {scope === 'vectorscope' && (
                <div className="mx-auto w-52">
                    <Vectorscope frameUrl={frameUrl} />
                </div>
            )}
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
        </InspectorSection>
    )
}
