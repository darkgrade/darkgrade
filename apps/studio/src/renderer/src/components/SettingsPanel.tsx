import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    ComboboxTrigger,
} from '@kevinschaich/components'
import { CONTROL_TRIGGER_CLASS, ControlRow, SEARCH_FROM } from '@renderer/components/ControlRow'
import { InspectorSection } from '@renderer/components/InspectorSection'
import {
    advertisedExposureValues,
    apertureToNumber,
    isoToNumber,
    nearestIndex,
    shutterDialToNumber,
    stepValue,
} from '@shared/exposure-stops'
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
        <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-muted-foreground">{label}</span>
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
                    aria-label={label}
                    render={<button type="button" className={CONTROL_TRIGGER_CLASS} onWheel={onWheel} />}
                >
                    <span className="truncate tabular-nums">{currentValue ? format(currentValue) : '—'}</span>
                </ComboboxTrigger>
                <ComboboxContent className="min-w-32">
                    {/* Search only a list long enough to need it (ISO, shutter), not a handful of choices. */}
                    {options.length > SEARCH_FROM && (
                        <ComboboxInput showTrigger={false} placeholder={`Search ${label.toLowerCase()}`} />
                    )}
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
        </div>
    )
}

function formatShutter(value: string): string {
    if (/bulb/i.test(value)) return 'Bulb'
    if (/°|time|flash/i.test(value)) return value
    if (value.includes('/')) return value
    return `${value.replace(/["″]/g, '')}″`
}

function formatAperture(value: string): string {
    return value.toLowerCase().startsWith('f') ? `ƒ/${value.replace(/^f\/?/i, '')}` : `ƒ/${value}`
}

/** Slate spells compensation in stops ("+0.7", "0.0"); read it as EV with a real minus sign. */
function formatCompensation(value: string): string {
    return value === '0.0' ? '±0 EV' : `${value.replace(/^-/, '−')} EV`
}

function formatIso(value: string): string {
    const number = value.replace(/^iso\s*/i, '')
    return /auto/i.test(number) ? 'Auto' : number
}

interface SettingsPanelProps {
    cameraState: CameraState
    /** True while the card is read; changing settings then would interrupt the transfer. */
    locked: boolean
    onChangeControl: (name: CameraControlName, value: string) => void
}

export function SettingsPanel({
    cameraState,
    locked,
    onChangeControl,
}: SettingsPanelProps): React.JSX.Element {
    const disabled = !cameraState.connected || locked
    return (
        <InspectorSection title="Exposure" collapsible defaultOpen>
            {!cameraState.connected ? (
                <p className="text-muted-foreground">Connect a camera to set exposure.</p>
            ) : (
                <div className="flex flex-col gap-1.75">
                    <div className="contents">
                        <ExposureDial
                            label="Shutter"
                            currentValue={cameraState.settings.shutterSpeed}
                            values={advertisedExposureValues(cameraState.controls?.shutterSpeed?.options, shutterDialToNumber, true)}
                            toNumber={shutterDialToNumber}
                            format={formatShutter}
                            disabled={disabled || !cameraState.controls?.shutterSpeed?.enabled || !cameraState.controls.shutterSpeed.options.length}
                            onApply={value => onChangeControl('shutterSpeed', value)}
                        />
                        <ExposureDial
                            label="Aperture"
                            currentValue={cameraState.settings.aperture}
                            values={advertisedExposureValues(cameraState.controls?.aperture?.options, apertureToNumber)}
                            toNumber={apertureToNumber}
                            format={formatAperture}
                            disabled={disabled || !cameraState.controls?.aperture?.enabled || !cameraState.controls.aperture.options.length}
                            onApply={value => onChangeControl('aperture', value)}
                        />
                        <ExposureDial
                            label="ISO"
                            currentValue={cameraState.settings.iso}
                            values={advertisedExposureValues(cameraState.controls?.iso?.options, isoToNumber)}
                            toNumber={isoToNumber}
                            format={formatIso}
                            disabled={disabled || !cameraState.controls?.iso?.enabled || !cameraState.controls.iso.options.length}
                            onApply={value => onChangeControl('iso', value)}
                        />
                    </div>
                    {cameraState.controls && (
                        <div className="contents">
                            <ControlRow
                                label="Mode"
                                control={cameraState.controls.exposureMode}
                                disabled={disabled}
                                onChange={value => onChangeControl('exposureMode', value)}
                            />
                            <ControlRow
                                label="Exposure comp."
                                control={cameraState.controls.exposureCompensation}
                                disabled={disabled}
                                onChange={value => onChangeControl('exposureCompensation', value)}
                                format={formatCompensation}
                            />
                            <ControlRow
                                label="Metering"
                                control={cameraState.controls.meteringMode}
                                disabled={disabled}
                                onChange={value => onChangeControl('meteringMode', value)}
                            />
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
                </div>
            )}
        </InspectorSection>
    )
}
