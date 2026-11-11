import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    ComboboxTrigger,
} from '@kevinschaich/components'
import type { CameraControl } from '@shared/ipc'

interface ControlRowProps {
    label: string
    control: CameraControl | null
    disabled: boolean
    onChange: (value: string) => void
    /** How a value reads to a person (e.g. "5600" → "5600 K"); the raw value is what's sent. */
    format?: (value: string) => string
}

/** A camera setting as a label on the left and its allowed values in a combobox on the right. */
export function ControlRow({
    label,
    control,
    disabled,
    onChange,
    format = value => value,
}: ControlRowProps): React.JSX.Element | null {
    if (!control) return null
    const options = control.options.length > 0 ? control.options : control.value ? [control.value] : []
    const choices = options.map(option => ({ value: option, label: format(option) }))
    const unavailable = disabled || !control.enabled || options.length < 2
    return (
        <div className="flex min-h-8 items-center justify-between gap-3">
            <span className="text-muted-foreground">{label}</span>
            <Combobox<{ value: string; label: string }>
                items={choices}
                value={choices.find(option => option.value === control.value) ?? null}
                disabled={unavailable}
                itemToStringLabel={option => option.label}
                itemToStringValue={option => option.value}
                isItemEqualToValue={(item, current) => item.value === current.value}
                onValueChange={option => {
                    if (option && option.value !== control.value) onChange(option.value)
                }}
            >
                <ComboboxTrigger
                    aria-label={label}
                    render={
                        <button
                            type="button"
                            className="flex h-7 w-40 items-center justify-between gap-1.5 rounded-md bg-foreground/5 pr-2 pl-2.5 text-sm outline-none hover:bg-foreground/9 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 data-popup-open:bg-foreground/12"
                        />
                    }
                >
                    <span className="truncate">{control.value ? format(control.value) : '—'}</span>
                </ComboboxTrigger>
                <ComboboxContent className="min-w-44">
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
        </div>
    )
}
