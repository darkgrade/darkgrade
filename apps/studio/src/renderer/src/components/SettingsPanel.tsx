import {
    APERTURE_VALUES,
    apertureToNumber,
    ISO_VALUES,
    isoToNumber,
    nearestIndex,
    SHUTTER_VALUES,
    shutterToNumber,
} from '@renderer/lib/exposure-stops'
import type { CameraState } from '@shared/ipc'
import { useEffect, useRef, useState } from 'react'

interface StopControlProps {
    label: string
    currentValue: string | null
    values: string[]
    toNumber: (value: string) => number | null
    disabled: boolean
    onApply: (value: string) => void
}

function StopControl({
    label,
    currentValue,
    values,
    toNumber,
    disabled,
    onApply,
}: StopControlProps): React.JSX.Element {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState('')
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (editing) inputRef.current?.focus()
    }, [editing])

    const step = (direction: -1 | 1): void => {
        const index = nearestIndex(values, currentValue, toNumber)
        const nextIndex = Math.min(values.length - 1, Math.max(0, index + direction))
        if (values[nextIndex] !== currentValue) onApply(values[nextIndex])
    }

    const commitDraft = (): void => {
        setEditing(false)
        const value = draft.trim()
        if (value && value !== currentValue) onApply(value)
    }

    return (
        <div className="stop-control">
            <div className="stop-label">{label}</div>
            <div className="stop-row">
                <button className="stop-step" disabled={disabled} onClick={() => step(-1)} title={`${label} down`}>
                    ‹
                </button>
                {editing ? (
                    <input
                        ref={inputRef}
                        className="stop-input"
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter') commitDraft()
                            if (event.key === 'Escape') setEditing(false)
                        }}
                        onBlur={() => setEditing(false)}
                    />
                ) : (
                    <button
                        className="stop-value"
                        disabled={disabled}
                        title="Click to type a value"
                        onClick={() => {
                            setDraft(currentValue ?? '')
                            setEditing(true)
                        }}
                    >
                        {currentValue ?? '—'}
                    </button>
                )}
                <button className="stop-step" disabled={disabled} onClick={() => step(1)} title={`${label} up`}>
                    ›
                </button>
            </div>
        </div>
    )
}

interface SettingsPanelProps {
    cameraState: CameraState
    onSetIso: (value: string) => void
    onSetShutterSpeed: (value: string) => void
    onSetAperture: (value: string) => void
    onRefresh: () => void
}

export function SettingsPanel({
    cameraState,
    onSetIso,
    onSetShutterSpeed,
    onSetAperture,
    onRefresh,
}: SettingsPanelProps): React.JSX.Element {
    const disabled = !cameraState.connected
    return (
        <div className="panel">
            <div className="panel-header">
                <h2>Exposure</h2>
                <button className="button button-small button-ghost" disabled={disabled} onClick={onRefresh}>
                    Refresh
                </button>
            </div>
            <div className="exposure-grid">
                <StopControl
                    label="ISO"
                    currentValue={cameraState.settings.iso}
                    values={ISO_VALUES}
                    toNumber={isoToNumber}
                    disabled={disabled}
                    onApply={onSetIso}
                />
                <StopControl
                    label="Shutter"
                    currentValue={cameraState.settings.shutterSpeed}
                    values={SHUTTER_VALUES}
                    toNumber={shutterToNumber}
                    disabled={disabled}
                    onApply={onSetShutterSpeed}
                />
                <StopControl
                    label="Aperture"
                    currentValue={cameraState.settings.aperture}
                    values={APERTURE_VALUES}
                    toNumber={apertureToNumber}
                    disabled={disabled}
                    onApply={onSetAperture}
                />
            </div>
        </div>
    )
}
