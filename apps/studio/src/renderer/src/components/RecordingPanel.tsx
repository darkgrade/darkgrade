import { ToggleGroup, ToggleGroupItem } from '@kevinschaich/components'
import { ControlRow } from '@renderer/components/ControlRow'
import { InspectorSection } from '@renderer/components/InspectorSection'
import type { CameraControl, CameraControlName, CameraState } from '@shared/ipc'
import { useRecordingClock } from '@renderer/lib/recording-clock'

interface RecordingPanelProps {
    cameraState: CameraState
    locked: boolean
    onChange: (name: CameraControlName, value: string) => void
}

type ShootingMode = 'photo' | 'video'

/** Slate's photoVideoMode: 'photo' or 'video', with only the modes the camera can switch to as options. */
function shootingModeOf(value: string | null | undefined): ShootingMode | null {
    return value === 'photo' || value === 'video' ? value : null
}

/**
 * Why a segment is off: Slate offers only the same program in the other half (Manual and Movie
 * Manual), never a guess, so from Auto, a scene, S&Q or interval the camera's dial decides.
 */
function unavailableModeTip(control: CameraControl | null | undefined, target: ShootingMode): string | undefined {
    if (!control || control.value === target || control.options.includes(target)) return undefined
    return target === 'video'
        ? 'The camera offers no switch to video from this mode. Choose M, A, S or P on the camera, or switch there.'
        : 'The camera offers no switch to photo from this mode. Choose movie M, A, S or P on the camera, or switch there.'
}

const SEGMENT_CLASS =
    'flex-1 rounded-md! text-muted-foreground hover:bg-transparent hover:text-foreground data-[pressed]:bg-foreground/12 data-[pressed]:text-foreground'

export function RecordingPanel({ cameraState, locked, onChange }: RecordingPanelProps): React.JSX.Element {
    const controls = cameraState.controls
    const elapsed = useRecordingClock(cameraState.recordingState === 'recording')
    // The body won't change movie settings mid-take.
    const disabled = !cameraState.connected || locked || cameraState.recording
    const photoDisabled = !cameraState.connected || locked
    return (
        <InspectorSection
            title="Recording"
            collapsible
            defaultOpen
            action={
                elapsed ? (
                    <span className="flex items-center gap-1.5 text-[12px] font-medium text-rec tabular-nums">
                        <span className="size-2 animate-pulse rounded-full bg-rec" aria-hidden /> {elapsed}
                    </span>
                ) : cameraState.recording && cameraState.recordingState !== 'recording'
                    ? <span className="text-xs text-muted-foreground">{cameraState.recordingState === 'idle'
                        ? 'Recording stopped; finishing camera setup' : `Recording state ${cameraState.recordingState}`}</span>
                    : undefined
            }
        >
            {controls ? (
                <div className="flex flex-col gap-6">
                    {shootingModeOf(controls.photoVideoMode?.value) && (
                        <ToggleGroup
                            className="w-full rounded-lg bg-foreground/6 p-0.5"
                            spacing={0}
                            size="sm"
                            value={[shootingModeOf(controls.photoVideoMode?.value) as ShootingMode]}
                            onValueChange={values => {
                                const target = values[0] as ShootingMode | undefined
                                const mode = controls.photoVideoMode
                                if (!target || !mode?.value || target === mode.value) return
                                if (mode.options.includes(target)) onChange('photoVideoMode', target)
                            }}
                            disabled={disabled || !controls.photoVideoMode?.enabled}
                            aria-label="Photo or video"
                        >
                            <ToggleGroupItem
                                value="photo"
                                className={SEGMENT_CLASS}
                                disabled={!controls.photoVideoMode?.options.includes('photo')}
                                title={unavailableModeTip(controls.photoVideoMode, 'photo')}
                            >
                                Photo
                            </ToggleGroupItem>
                            <ToggleGroupItem
                                value="video"
                                className={SEGMENT_CLASS}
                                disabled={!controls.photoVideoMode?.options.includes('video')}
                                title={unavailableModeTip(controls.photoVideoMode, 'video')}
                            >
                                Movie
                            </ToggleGroupItem>
                        </ToggleGroup>
                    )}
                    <div className="flex flex-col gap-1.75">
                        <span className="slate-label">Photo</span>
                        <ControlRow
                            label="Format"
                            control={controls.photoFormat}
                            disabled={photoDisabled}
                            onChange={value => onChange('photoFormat', value)}
                        />
                        <ControlRow
                            label="Size"
                            control={controls.photoSize}
                            disabled={photoDisabled}
                            onChange={value => onChange('photoSize', value)}
                        />
                        <ControlRow
                            label="Aspect"
                            control={controls.aspectRatio}
                            disabled={photoDisabled}
                            onChange={value => onChange('aspectRatio', value)}
                        />
                        <ControlRow
                            label="JPEG quality"
                            control={controls.jpegQuality}
                            disabled={photoDisabled}
                            onChange={value => onChange('jpegQuality', value)}
                        />
                    </div>
                    <div className="flex flex-col gap-1.75">
                        <span className="slate-label">Video</span>
                        <ControlRow
                            label="Format"
                            control={controls.videoFormat}
                            disabled={disabled}
                            onChange={value => onChange('videoFormat', value)}
                        />
                        <ControlRow
                            label="Quality"
                            control={controls.videoQuality}
                            disabled={disabled}
                            onChange={value => onChange('videoQuality', value)}
                        />
                        <ControlRow
                            label="Frame rate"
                            control={controls.frameRate}
                            disabled={disabled}
                            onChange={value => onChange('frameRate', value)}
                        />
                        <ControlRow
                            label="Audio"
                            control={controls.audioRecording}
                            disabled={disabled}
                            onChange={value => onChange('audioRecording', value)}
                        />
                    </div>
                </div>
            ) : (
                <p className="text-muted-foreground">
                    {cameraState.connected
                        ? 'This camera doesn’t report its movie settings yet.'
                        : 'Connect a camera to set up recording.'}
                </p>
            )}
        </InspectorSection>
    )
}
