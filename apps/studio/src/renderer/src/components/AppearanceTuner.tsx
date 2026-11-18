import { Button, Slider, Switch } from '@kevinschaich/components'
import { ControlRow } from '@renderer/components/ControlRow'
import { InspectorSection } from '@renderer/components/InspectorSection'
import { createStore } from '@renderer/lib/external-store'
import { WINDOW_MATERIALS, type Preferences, type WindowMaterial } from '@shared/ipc'
import { useEffect, useState } from 'react'

/** The tint laid over the window's vibrancy: a colour and an opacity (0–100). */
export interface Appearance {
    windowColor: string
    windowOpacity: number
}

const DEFAULT_APPEARANCE: Appearance = {
    windowColor: '#000000',
    windowOpacity: 50,
}
const STORAGE_KEY = 'studio.appearance'

function load(): Appearance {
    try {
        return {
            ...DEFAULT_APPEARANCE,
            ...(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Appearance>),
        }
    } catch {
        return DEFAULT_APPEARANCE
    }
}

function rgba(hex: string, opacity: number): string {
    const value = Number.parseInt(hex.slice(1), 16)
    return `rgb(${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255} / ${opacity}%)`
}

function apply(value: Appearance): void {
    const root = document.documentElement.style
    root.setProperty('--window-tint', rgba(value.windowColor, value.windowOpacity))
}

/** The appearance as tuned: applied and kept in this window as it changes, read by the viewer for its layout. */
export const appearance = createStore<Appearance>(load())

function save(value: Appearance): void {
    apply(value)
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch {
        // Not kept; the colours still apply for this session.
    }
}

// Tuned colours apply from launch, whether or not Developer Mode shows the tuner.
apply(appearance.get())

function ColorRow(props: {
    label: string
    color: string
    opacity: number
    onChange: (color: string, opacity: number) => void
}): React.JSX.Element {
    return (
        <div className="flex flex-col gap-1.75">
            <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{props.label}</span>
                <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground tabular-nums">
                    {props.color} · {props.opacity}%
                    <input
                        type="color"
                        value={props.color}
                        onChange={event => props.onChange(event.target.value, props.opacity)}
                        aria-label={`${props.label} colour`}
                        className="size-6 cursor-pointer rounded-sm border border-foreground/15 bg-transparent p-0"
                    />
                </span>
            </div>
            <Slider
                min={0}
                max={100}
                value={props.opacity}
                onValueChange={value => props.onChange(props.color, Array.isArray(value) ? value[0] : value)}
                aria-label={`${props.label} opacity`}
            />
        </div>
    )
}

/**
 * Developer Mode's live appearance tuning: the window's macOS material and the tint laid over it.
 * Changes show at once and are kept in this window; the values read out so they can be made the defaults.
 */
export function AppearanceTuner(): React.JSX.Element {
    const tuned = appearance.use()
    const setAppearance = (change: Appearance | ((previous: Appearance) => Appearance)): void => {
        const next = typeof change === 'function' ? change(appearance.get()) : change
        appearance.set(next)
        save(next)
    }
    // The window's material and its dimming are saved with Studio's settings: the main process applies them.
    const [preferences, setPreferences] = useState<Preferences | null>(null)
    useEffect(() => {
        void window.studio.getPreferences().then(result => result.ok && setPreferences(result.data))
        return window.studio.onPreferences(setPreferences)
    }, [])
    return (
        <InspectorSection
            title="Appearance"
            collapsible
            defaultOpen
            action={
                <Button
                    variant="ghost"
                    size="xs"
                    className="quiet-control"
                    onClick={() => setAppearance(DEFAULT_APPEARANCE)}
                >
                    Reset
                </Button>
            }
        >
            <div className="flex flex-col gap-3">
                {preferences && (
                    <div className="flex flex-col gap-1.75">
                        <ControlRow
                            label="Material"
                            control={{
                                value: preferences.windowMaterial,
                                options: WINDOW_MATERIALS.map(([material]) => material),
                                enabled: true,
                            }}
                            disabled={false}
                            format={value => WINDOW_MATERIALS.find(([material]) => material === value)?.[1] ?? value}
                            onChange={value =>
                                void window.studio.setPreferences({ windowMaterial: value as WindowMaterial })
                            }
                        />
                        <label
                            className="flex items-center justify-between gap-2 leading-none"
                            title="From the next launch"
                        >
                            <span className="text-muted-foreground">Dim when inactive</span>
                            <Switch
                                checked={preferences.dimWhenInactive}
                                onCheckedChange={dimWhenInactive =>
                                    void window.studio.setPreferences({ dimWhenInactive })
                                }
                            />
                        </label>
                    </div>
                )}
                <ColorRow
                    label="Window tint"
                    color={tuned.windowColor}
                    opacity={tuned.windowOpacity}
                    onChange={(windowColor, windowOpacity) =>
                        setAppearance(previous => ({ ...previous, windowColor, windowOpacity }))
                    }
                />
                <p className="text-[11px] text-muted-foreground">
                    The material switches live; dimming while Studio is in the background applies from the next launch.
                </p>
            </div>
        </InspectorSection>
    )
}
