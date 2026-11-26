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
                <div className="flex flex-col gap-1.75">
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
                    {controls.subjectDetection && (
                        <label className="flex items-center justify-between gap-2 leading-none">
                            <span className="text-muted-foreground">Eye tracking</span>
                            <Switch
                                checked={controls.subjectDetection.value === 'On'}
                                disabled={disabled || !controls.subjectDetection.enabled}
                                onCheckedChange={checked => onChange('subjectDetection', checked ? 'On' : 'Off')}
                            />
                        </label>
                    )}
                    {controls.subjectDetection?.value === 'On' && (
                        <>
                            <ControlRow
                                label="Subject"
                                control={controls.detectionSubject}
                                disabled={disabled}
                                onChange={value => onChange('detectionSubject', value)}
                            />
                            <ControlRow
                                label="Eye"
                                control={controls.eyeSelection}
                                disabled={disabled}
                                onChange={value => onChange('eyeSelection', value)}
                            />
                        </>
                    )}
                    <p className="pt-1 text-[11px] text-muted-foreground">
                        Click the picture to focus there. Wide, Zone and Center switch to your last spot until you
                        press Focus.
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
