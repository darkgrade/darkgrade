import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    ComboboxTrigger,
} from '@kevinschaich/components'
import { ControlRow } from '@renderer/components/ControlRow'
import { InspectorSection } from '@renderer/components/InspectorSection'
import {
    APERTURE_VALUES,
    apertureToNumber,
    ISO_VALUES,
    isoToNumber,
    nearestIndex,
    SHUTTER_VALUES,
    shutterToNumber,
    stepValue,
} from '@renderer/lib/exposure-stops'
import type { CameraControl, CameraControlName, CameraState } from '@shared/ipc'
import { useRef } from 'react'

const WHEEL_STEP_INTERVAL_MS = 90

interface ExposureDialProps {
    label: string
    currentValue: string | null
    values: string[]
    toNumber: (value: string) => number | null
    format: (value: string) => string
    disabled: boolean
    onApply: (value: string) => void
}

/**
 * The dial's stops that the camera allows right now (it reports them with each setting, and they change
 * with the lens, focal length and mode). Values are matched by number, so "ISO 1600" and "1600" agree;
 * Auto and Bulb, which have no number, are kept when the camera lists them. Without a list, every stop.
 */
function allowedStops(
    values: string[],
    control: CameraControl | null,
    toNumber: (value: string) => number | null
): string[] {
    if (!control || control.options.length === 0) return values
    const allowedNumbers = control.options.map(toNumber).filter((number): number is number => number !== null)
    const allowedWords = control.options.map(option => option.toLowerCase())
    const allowed = values.filter(value => {
        const number = toNumber(value)
        if (number === null) return allowedWords.some(word => word.includes(value.toLowerCase()))
        return allowedNumbers.some(allowedNumber => Math.abs(allowedNumber - number) <= number * 0.01)
    })
    return allowed.length > 0 ? allowed : values
}

/** A camera-style readout: click for every third-stop, or scroll over it to step one third. */
function ExposureDial({
    label,
    currentValue,
    values,
    toNumber,
    format,
    disabled,
    onApply,
}: ExposureDialProps): React.JSX.Element {
    const lastWheelStepMs = useRef(0)
    const selected = currentValue === null ? null : values[nearestIndex(values, currentValue, toNumber)]
    const options = values.map(value => ({ value, label: format(value) }))

    const onWheel = (event: React.WheelEvent): void => {
        if (disabled || event.deltaY === 0) return
        const now = performance.now()
        if (now - lastWheelStepMs.current < WHEEL_STEP_INTERVAL_MS) return
        lastWheelStepMs.current = now
        const next = stepValue(values, currentValue, toNumber, event.deltaY > 0 ? 1 : -1)
        if (next && next !== selected) onApply(next)
    }

    return (
        <Combobox<{ value: string; label: string }>
            items={options}
            value={options.find(option => option.value === selected) ?? null}
            disabled={disabled}
            itemToStringLabel={option => option.label}
            itemToStringValue={option => option.value}
            isItemEqualToValue={(item, current) => item.value === current.value}
            onValueChange={option => {
                if (option && option.value !== selected) onApply(option.value)
            }}
        >
            <ComboboxTrigger
                aria-label={`${label}: ${currentValue ? format(currentValue) : 'unknown'}`}
                render={
                    <button
                        type="button"
                        className="flex w-full flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 transition-colors outline-none hover:bg-foreground/6 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 disabled:hover:bg-transparent data-popup-open:bg-foreground/10 [&>svg]:hidden"
                        onWheel={onWheel}
                    />
                }
            >
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <span className="text-[19px] leading-none font-semibold tracking-tight text-foreground tabular-nums">
                    {currentValue ? format(currentValue) : '—'}
                </span>
            </ComboboxTrigger>
            <ComboboxContent className="min-w-32">
                <ComboboxInput showTrigger={false} placeholder={`Search ${label.toLowerCase()}`} />
                <ComboboxEmpty>No matches</ComboboxEmpty>
                <ComboboxList>
                    {(option: { value: string; label: string }) => (
                        <ComboboxItem key={option.value} value={option} className="tabular-nums">
                            {option.label}
                        </ComboboxItem>
                    )}
                </ComboboxList>
            </ComboboxContent>
        </Combobox>
    )
}

function formatShutter(value: string): string {
    if (/bulb/i.test(value)) return 'Bulb'
    if (value.includes('/')) return value
    return `${value.replace(/["″]/g, '')}″`
}

function formatAperture(value: string): string {
    return value.toLowerCase().startsWith('f') ? `ƒ/${value.replace(/^f\/?/i, '')}` : `ƒ/${value}`
}

function formatIso(value: string): string {
    const number = value.replace(/^iso\s*/i, '')
    return /auto/i.test(number) ? 'Auto' : number
}

interface SettingsPanelProps {
    cameraState: CameraState
    /** True while the card is read; changing settings then would interrupt the transfer. */
    locked: boolean
    onSetIso: (value: string) => void
    onSetShutterSpeed: (value: string) => void
    onSetAperture: (value: string) => void
    onChangeControl: (name: CameraControlName, value: string) => void
}

export function SettingsPanel({
    cameraState,
    locked,
    onSetIso,
    onSetShutterSpeed,
    onSetAperture,
    onChangeControl,
}: SettingsPanelProps): React.JSX.Element {
    const disabled = !cameraState.connected || locked
    return (
        <InspectorSection title="Exposure" collapsible defaultOpen>
            <div className="grid grid-cols-3 gap-1">
                <ExposureDial
                    label="Shutter"
                    currentValue={cameraState.settings.shutterSpeed}
                    values={allowedStops(SHUTTER_VALUES, cameraState.controls?.shutterSpeed ?? null, shutterToNumber)}
                    toNumber={shutterToNumber}
                    format={formatShutter}
                    disabled={disabled}
                    onApply={onSetShutterSpeed}
                />
                <ExposureDial
                    label="Aperture"
                    currentValue={cameraState.settings.aperture}
                    values={allowedStops(APERTURE_VALUES, cameraState.controls?.aperture ?? null, apertureToNumber)}
                    toNumber={apertureToNumber}
                    format={formatAperture}
                    disabled={disabled}
                    onApply={onSetAperture}
                />
                <ExposureDial
                    label="ISO"
                    currentValue={cameraState.settings.iso}
                    values={allowedStops(ISO_VALUES, cameraState.controls?.iso ?? null, isoToNumber)}
                    toNumber={isoToNumber}
                    format={formatIso}
                    disabled={disabled}
                    onApply={onSetIso}
                />
            </div>
            {cameraState.controls && (
                <div className="flex flex-col gap-1">
                    <ControlRow
                        label="White balance"
                        control={cameraState.controls.whiteBalance}
                        disabled={disabled}
                        onChange={value => onChangeControl('whiteBalance', value)}
                    />
                    <ControlRow
                        label="Temperature"
                        control={cameraState.controls.colorTemperature}
                        disabled={disabled}
                        onChange={value => onChangeControl('colorTemperature', value)}
                        format={value => `${value} K`}
                    />
                </div>
            )}
        </InspectorSection>
    )
}
