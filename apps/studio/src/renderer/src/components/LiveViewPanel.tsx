import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    Kbd,
    Spinner,
} from '@kevinschaich/components'
import { HoverTip } from '@renderer/components/HoverTip'
import { PreviewQuality, type PreviewQualityProps } from '@renderer/components/PreviewQuality'
import { useRecordingClock } from '@renderer/components/RecordingPanel'
import type { PreviewAssistSettings } from '@renderer/gpu/assists'
import { LivePicture } from '@renderer/gpu/LivePicture'
import { useFocusFrames, useHasLiveFrame } from '@renderer/lib/live-frame-store'
import type { CameraState, FocusFrame } from '@shared/ipc'
import { Camera, Crosshair, Mic, VideoOff } from 'lucide-react'
import { useRef, useState } from 'react'

interface LiveViewPanelProps {
    /** Floats over the top of the picture (the camera pill), as the toolbar floats over its bottom. */
    header: React.ReactNode
    cameraState: CameraState
    busy: boolean
    capturing: boolean
    /** The camera is reading its card, so live view is paused on purpose. */
    readingCard: boolean
    /** Controls wait while the card is read. */
    locked: boolean
    onRetryLiveView: () => void
    onFocus: () => void
    /** Focus on a point of the picture (0–1 from the top left); resolves true when the camera focused. */
    onFocusAt: ((x: number, y: number) => Promise<boolean>) | null
    /** Zebras and focus peaking drawn over the picture by Studio. */
    previewAssists: PreviewAssistSettings
    onCapture: () => void
    onStartRecording: () => void
    onStopRecording: () => void
    /** The voice panel opens under the picture from the toolbar's microphone; open is listening. */
    voiceOpen: boolean
    voiceListening: boolean
    onToggleVoice: () => void
    /** The live preview's quality switch and details, shown in the toolbar. */
    preview: PreviewQualityProps
}

function ViewportPlaceholder(
    props: Pick<LiveViewPanelProps, 'cameraState' | 'onRetryLiveView' | 'readingCard'>
): React.JSX.Element {
    const { cameraState } = props
    if (cameraState.connected && props.readingCard) {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> Reading the card — live view resumes when it’s done
            </div>
        )
    }
    if (!cameraState.connected) {
        return (
            <Empty>
                <EmptyHeader>
                    <EmptyMedia variant="icon">{cameraState.phase === 'idle' ? <Camera /> : <Spinner />}</EmptyMedia>
                    <EmptyTitle>
                        {cameraState.phase === 'idle' ? 'Plug in a camera' : 'Connecting to camera…'}
                    </EmptyTitle>
                    <EmptyDescription>
                        Connect over USB with the camera in PC Remote mode. Studio connects automatically.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        )
    }
    if (cameraState.liveView) {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> Starting live view…
            </div>
        )
    }
    return (
        <Empty>
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <VideoOff />
                </EmptyMedia>
                <EmptyTitle>Live view paused</EmptyTitle>
                <EmptyDescription>Capture still works without it.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button variant="outline" size="sm" onClick={props.onRetryLiveView}>
                    Resume live view
                </Button>
            </EmptyContent>
        </Empty>
    )
}

interface CameraControlsProps extends LiveViewPanelProps {
    disabled: boolean
}

/**
 * Focus, shutter, record and voice as icons in a small floating toolbar under the picture, on white at 5% opacity, with no edge.
 */
function CameraControls(props: CameraControlsProps): React.JSX.Element {
    const { cameraState, disabled } = props
    const tool =
        'size-9 rounded-lg p-0 text-foreground/80 hover:bg-foreground/8 hover:text-foreground [&_svg]:size-[18px]'
    return (
        <div className="flex shrink-0 justify-center">
            <div className="flex items-center gap-1 rounded-xl bg-black/55 p-1 backdrop-blur-sm">
                <HoverTip
                    tip={
                        <>
                            Autofocus <Kbd>F</Kbd>
                        </>
                    }
                    render={
                        <Button
                            variant="ghost"
                            className={tool}
                            disabled={disabled}
                            onClick={props.onFocus}
                            aria-label="Autofocus"
                        />
                    }
                >
                    <Crosshair aria-hidden />
                </HoverTip>
                <HoverTip
                    tip={
                        <>
                            Take photo <Kbd>Return</Kbd>
                        </>
                    }
                    render={
                        <Button
                            variant="ghost"
                            className={tool}
                            disabled={disabled}
                            onClick={props.onCapture}
                            aria-label="Take photo"
                        />
                    }
                >
                    {props.capturing ? (
                        <Spinner />
                    ) : (
                        <span
                            className="flex size-[15px] items-center justify-center rounded-full border-[1.5px] border-current"
                            aria-hidden
                        >
                            <span className="size-[7px] rounded-full bg-current" />
                        </span>
                    )}
                </HoverTip>
                {cameraState.recording ? (
                    <HoverTip
                        tip="Stop recording"
                        render={
                            <Button
                                variant="ghost"
                                className={`${tool} text-rec hover:text-rec`}
                                disabled={!cameraState.connected}
                                onClick={props.onStopRecording}
                                aria-label="Stop recording"
                            />
                        }
                    >
                        <span className="size-[13px] rounded-[3px] bg-rec" aria-hidden />
                    </HoverTip>
                ) : (
                    <HoverTip
                        tip="Record video"
                        render={
                            <Button
                                variant="ghost"
                                className={tool}
                                disabled={disabled}
                                onClick={props.onStartRecording}
                                aria-label="Record video"
                            />
                        }
                    >
                        <span className="size-[15px] rounded-full bg-rec" aria-hidden />
                    </HoverTip>
                )}
                <span className="mx-1 h-5 w-px bg-foreground/10" aria-hidden />
                {cameraState.connected && <PreviewQuality {...props.preview} className={tool} />}
                <HoverTip
                    tip={props.voiceOpen ? 'Stop voice' : 'Voice'}
                    render={
                        <Button
                            variant="ghost"
                            className={`${tool} ${props.voiceOpen ? 'bg-gold-dim text-gold hover:bg-gold-dim hover:text-gold' : ''}`}
                            onClick={props.onToggleVoice}
                            aria-pressed={props.voiceOpen}
                            aria-controls="voice-panel"
                            aria-label="Voice"
                        />
                    }
                >
                    <span className="relative flex">
                        <Mic aria-hidden />
                        {props.voiceListening && (
                            <span className="voice-live-dot absolute -top-0.5 -right-1 size-1.5!" aria-hidden />
                        )}
                    </span>
                </HoverTip>
            </div>
        </div>
    )
}

type FocusMarker = { x: number; y: number; status: 'focusing' | 'focused' | 'failed' }

const MARKER_COLORS: Record<FocusMarker['status'], string> = {
    focusing: 'border-amber-300',
    focused: 'border-live',
    failed: 'border-destructive',
}

const FRAME_COLORS: Record<FocusFrame['kind'], string> = {
    focus: 'border-white/85',
    face: 'border-white/70',
    tracking: 'border-sky-300/85',
}

/**
 * A frame the camera draws over live view, at its own size: white, green once in focus. A click
 * moves it straight to the clicked point at the same size (amber, then green or red) while the
 * camera catches up.
 */
function CameraFocusFrame({ frame, marker }: { frame: FocusFrame; marker?: FocusMarker }): React.JSX.Element {
    const color = marker ? MARKER_COLORS[marker.status] : frame.focused ? 'border-live' : FRAME_COLORS[frame.kind]
    const centerX = marker?.x ?? frame.centerX
    const centerY = marker?.y ?? frame.centerY
    return (
        <span
            className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-[3px] border-2 shadow-[0_0_0_1px_rgb(0_0_0/0.35)] transition-[left,top,width,height,border-color] duration-150 ${color}`}
            style={{
                left: `${centerX * 100}%`,
                top: `${centerY * 100}%`,
                width: `${frame.width * 100}%`,
                height: `${frame.height * 100}%`,
            }}
            aria-hidden
        />
    )
}

/** Flexible Spot S on the A7 V, for a click before the camera has drawn any focus frame. */
const DEFAULT_FOCUS_FRAME: FocusFrame = {
    kind: 'focus',
    focused: false,
    centerX: 0.5,
    centerY: 0.5,
    width: 38 / 640,
    height: 38 / 480,
}

const FOCUS_RING_LINGER_MS = 1800

/** REC with how long the take has run, in the picture's corner: a monitor's tally and timecode. */
function RecordingBadge(): React.JSX.Element {
    const elapsed = useRecordingClock(true)
    return (
        <span className="absolute top-3 left-3 flex items-center gap-2 rounded-md bg-black/60 px-2 py-1 text-[11px] font-semibold tracking-[0.06em] text-rec tabular-nums">
            <span className="size-2 animate-pulse rounded-full bg-rec" aria-hidden />
            REC
            {elapsed && <span className="font-medium tracking-normal text-foreground/85">{elapsed}</span>}
        </span>
    )
}
/**
 * The camera's focus, face and eye frames over the picture. They can move every frame, so they subscribe here, on
 * their own, and only this small layer re-renders as they move, never the viewer or its toolbar.
 */
function FocusFrames({
    focusArea,
    marker,
    lastFocusFrame,
}: {
    focusArea: string | null
    marker: FocusMarker | null
    /** The current focus frame, kept for a click's marker to take its size. */
    lastFocusFrame: React.RefObject<FocusFrame>
}): React.JSX.Element {
    const focusFrames = useFocusFrames()
    const currentFocusFrame = focusFrames.find(frame => frame.kind === 'focus')
    if (currentFocusFrame) lastFocusFrame.current = currentFocusFrame
    if (marker) return <CameraFocusFrame frame={lastFocusFrame.current} marker={marker} />
    // The camera reports faces and eyes in every area, but in a Flexible Spot it focuses on the spot:
    // only show them where the camera picks the subject itself.
    const cameraPicksSubject = !/flexible spot/i.test(focusArea ?? '')
    const shownFrames = cameraPicksSubject ? focusFrames : focusFrames.filter(frame => frame.kind === 'focus')
    return (
        <>
            {shownFrames.map((frame, index) => (
                <CameraFocusFrame key={index} frame={frame} />
            ))}
        </>
    )
}

export function LiveViewPanel(props: LiveViewPanelProps): React.JSX.Element {
    const { cameraState } = props
    const hasLiveFrame = useHasLiveFrame()
    // Fill the panel at the frame's own shape, scaling past its native resolution if needed.
    const [frameAspect, setFrameAspect] = useState(3 / 2)
    const [focusMarker, setFocusMarker] = useState<FocusMarker | null>(null)
    const focusRingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    // The focus frame's size is kept when a click moves it, even while the camera switches areas.
    const lastFocusFrame = useRef<FocusFrame>(DEFAULT_FOCUS_FRAME)
    const disabled = !cameraState.connected || props.busy || props.locked
    const canFocusAt = props.onFocusAt !== null && !disabled && !props.readingCard
    // While the card is read, live view is paused: keep the last frame, dimmed and labelled, rather than flash.
    const showFrame = cameraState.connected && (cameraState.liveView || props.readingCard) && hasLiveFrame

    return (
        // The picture, 6px inside the card and as large as its shape allows, its 8px corners concentric with the card's.
        // The camera pill and the toolbar float over it, 12px from its top and bottom; clicks around them still focus.
        <div className="flex min-h-0 flex-1 items-center justify-center p-1.5 [container-type:size]">
            <div
                className={`relative overflow-hidden rounded-[8px] ${showFrame ? '' : 'bg-black/40'} ${canFocusAt ? 'cursor-crosshair!' : ''}`}
                style={{ aspectRatio: frameAspect, width: `min(100cqw, calc(100cqh * ${frameAspect}))` }}
                onClick={event => {
                    if (!showFrame || !canFocusAt || !props.onFocusAt) return
                    if ((event.target as HTMLElement).closest('button')) return
                    const bounds = event.currentTarget.getBoundingClientRect()
                    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
                    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
                    if (focusRingTimer.current) clearTimeout(focusRingTimer.current)
                    setFocusMarker({ x, y, status: 'focusing' })
                    void props.onFocusAt(x, y).then(focused => {
                        setFocusMarker(marker =>
                            marker && marker.x === x && marker.y === y
                                ? { ...marker, status: focused ? 'focused' : 'failed' }
                                : marker
                        )
                        focusRingTimer.current = setTimeout(() => setFocusMarker(null), FOCUS_RING_LINGER_MS)
                    })
                }}
                title={showFrame && canFocusAt ? 'Click to focus there' : undefined}
            >
                {showFrame ? (
                    <>
                        <LivePicture
                            assists={
                                props.readingCard
                                    ? { ...props.previewAssists, zebras: false, focusPeaking: false }
                                    : props.previewAssists
                            }
                            recording={cameraState.recording}
                            cameraDisplay={cameraState.osdOverlay === true}
                            dimmed={props.readingCard}
                            onAspect={aspect => {
                                if (Math.abs(aspect - frameAspect) > 0.01) setFrameAspect(aspect)
                            }}
                        />
                        {props.readingCard && (
                            <span className="absolute top-3 right-3 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] text-muted-foreground">
                                <Spinner className="size-3" /> Live view paused while the card is read
                            </span>
                        )}
                        {cameraState.recording && <RecordingBadge />}
                        <FocusFrames
                            focusArea={cameraState.controls?.focusArea?.value ?? null}
                            marker={focusMarker}
                            lastFocusFrame={lastFocusFrame}
                        />
                    </>
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center p-16">
                        <ViewportPlaceholder
                            cameraState={cameraState}
                            readingCard={props.readingCard}
                            onRetryLiveView={props.onRetryLiveView}
                        />
                    </div>
                )}
                <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center *:pointer-events-auto">
                    {props.header}
                </div>
                <div
                    className="absolute inset-x-0 bottom-3 flex justify-center"
                    onClick={event => event.stopPropagation()}
                >
                    <CameraControls {...props} disabled={disabled} />
                </div>
            </div>
        </div>
    )
}
