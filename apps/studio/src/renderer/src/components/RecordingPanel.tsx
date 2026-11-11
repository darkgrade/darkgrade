import { ToggleGroup, ToggleGroupItem } from '@kevinschaich/components'
import { ControlRow } from '@renderer/components/ControlRow'
import { InspectorSection } from '@renderer/components/InspectorSection'
import type { CameraControlName, CameraState } from '@shared/ipc'
import { useEffect, useState } from 'react'

interface RecordingPanelProps {
    cameraState: CameraState
    locked: boolean
    onChange: (name: CameraControlName, value: string) => void
}

function formatElapsed(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const pad = (value: number): string => String(value).padStart(2, '0')
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

type ShootingMode = 'photo' | 'movie'

/** Sony names movie exposure modes "Movie …"; everything else without S&Q or Interval is a photo mode. */
function shootingModeOf(exposureProgram: string): ShootingMode | null {
    if (/^(S&Q|Interval)/i.test(exposureProgram)) return null
    return /^Movie /i.test(exposureProgram) ? 'movie' : 'photo'
}

/** The same exposure mode in the other shooting mode: Manual ↔ Movie Manual, else that mode's first option. */
function exposureProgramFor(target: ShootingMode, current: string, options: string[]): string | null {
    const base = current.replace(/^Movie /i, '')
    const wanted = target === 'movie' ? `Movie ${base}` : base
    if (options.includes(wanted)) return wanted
    return options.find(option => shootingModeOf(option) === target) ?? null
}

const SEGMENT_CLASS =
    'flex-1 rounded-md! text-muted-foreground hover:bg-transparent hover:text-foreground data-[pressed]:bg-foreground/12 data-[pressed]:text-foreground'

/** Counts up from when recording started, as a timecode-style clock. */
function useRecordingClock(recording: boolean): string | null {
    const [startedAtMs, setStartedAtMs] = useState<number | null>(null)
    const [, setTick] = useState(0)
    useEffect(() => {
        if (!recording) {
            setStartedAtMs(null)
            return
        }
        setStartedAtMs(Date.now())
        const timer = setInterval(() => setTick(tick => tick + 1), 250)
        return () => clearInterval(timer)
    }, [recording])
    if (startedAtMs === null) return null
    return formatElapsed(Math.floor((Date.now() - startedAtMs) / 1000))
}

export function RecordingPanel({ cameraState, locked, onChange }: RecordingPanelProps): React.JSX.Element {
    const controls = cameraState.controls
    const elapsed = useRecordingClock(cameraState.recording)
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
                ) : undefined
            }
        >
            {controls ? (
                <div className="flex flex-col gap-3">
                    {controls.exposureProgram?.value && shootingModeOf(controls.exposureProgram.value) && (
                        <ToggleGroup
                            className="w-full rounded-lg bg-foreground/6 p-0.5"
                            spacing={0}
                            size="sm"
                            value={[shootingModeOf(controls.exposureProgram.value) as ShootingMode]}
                            onValueChange={values => {
                                const target = values[0] as ShootingMode | undefined
                                const program = controls.exposureProgram
                                if (!target || !program?.value) return
                                const next = exposureProgramFor(target, program.value, program.options)
                                if (next && next !== program.value) onChange('exposureProgram', next)
                            }}
                            disabled={disabled || !controls.exposureProgram.enabled}
                            aria-label="Photo or movie"
                        >
                            <ToggleGroupItem value="photo" className={SEGMENT_CLASS}>
                                Photo
                            </ToggleGroupItem>
                            <ToggleGroupItem value="movie" className={SEGMENT_CLASS}>
                                Movie
                            </ToggleGroupItem>
                        </ToggleGroup>
                    )}
                    <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">Photo</span>
                        <ControlRow
                            label="Format"
                            control={controls.stillFormat}
                            disabled={photoDisabled}
                            onChange={value => onChange('stillFormat', value)}
                        />
                        <ControlRow
                            label="Size"
                            control={controls.imageSize}
                            disabled={photoDisabled}
                            onChange={value => onChange('imageSize', value)}
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
                    <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">Video</span>
                        <ControlRow
                            label="Format"
                            control={controls.movieFormat}
                            disabled={disabled}
                            onChange={value => onChange('movieFormat', value)}
                        />
                        <ControlRow
                            label="Quality"
                            control={controls.movieSetting}
                            disabled={disabled}
                            onChange={value => onChange('movieSetting', value)}
                        />
                        <ControlRow
                            label="Frame rate"
                            control={controls.movieFrameRate}
                            disabled={disabled}
                            onChange={value => onChange('movieFrameRate', value)}
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
