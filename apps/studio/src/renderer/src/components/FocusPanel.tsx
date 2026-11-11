import { Switch } from '@kevinschaich/components'
import { ControlRow } from '@renderer/components/ControlRow'
import { InspectorSection } from '@renderer/components/InspectorSection'
import type { CameraControlName, CameraState } from '@shared/ipc'

interface FocusPanelProps {
    cameraState: CameraState
    locked: boolean
    onChange: (name: CameraControlName, value: string) => void
}

export function FocusPanel({ cameraState, locked, onChange }: FocusPanelProps): React.JSX.Element {
    const controls = cameraState.controls
    const disabled = !cameraState.connected || locked
    return (
        <InspectorSection title="Focus" collapsible defaultOpen>
            {controls ? (
                <div className="flex flex-col gap-1">
                    <ControlRow
                        label="Mode"
                        control={controls.focusMode}
                        disabled={disabled}
                        onChange={value => onChange('focusMode', value)}
                    />
                    <ControlRow
                        label="Area"
                        control={controls.focusArea}
                        disabled={disabled}
                        onChange={value => onChange('focusArea', value)}
                    />
                    {controls.subjectRecognition && (
                        <label className="flex h-8 items-center justify-between gap-2">
                            <span className="text-muted-foreground">Eye tracking</span>
                            <Switch
                                checked={controls.subjectRecognition.value === 'On'}
                                disabled={disabled || !controls.subjectRecognition.enabled}
                                onCheckedChange={checked => onChange('subjectRecognition', checked ? 'On' : 'Off')}
                            />
                        </label>
                    )}
                    {controls.subjectRecognition?.value === 'On' && (
                        <>
                            <ControlRow
                                label="Subject"
                                control={controls.recognitionTarget}
                                disabled={disabled}
                                onChange={value => onChange('recognitionTarget', value)}
                            />
                            <ControlRow
                                label="Eye"
                                control={controls.eyeSelect}
                                disabled={disabled}
                                onChange={value => onChange('eyeSelect', value)}
                            />
                        </>
                    )}
                    <p className="pt-1 text-[11px] text-muted-foreground">
                        Click the picture to move the focus area there. In Wide, Zone or Center it switches to your last
                        Flexible Spot until you press Focus.
                    </p>
                </div>
            ) : (
                <p className="text-muted-foreground">
                    {cameraState.connected
                        ? 'This camera doesn’t report its focus settings yet.'
                        : 'Connect a camera to set focus.'}
                </p>
            )}
        </InspectorSection>
    )
}
