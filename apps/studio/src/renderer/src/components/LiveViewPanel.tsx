import { useFocusFrames, useHasLiveFrame, useLiveFrame } from '@renderer/lib/live-frame-store'
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
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@kevinschaich/components'
import { TallyComet } from '@renderer/components/TallyComet'
import { PreviewAssistsOverlay, type PreviewAssistSettings } from '@renderer/scopes/PreviewAssists'
import type { CameraState, FocusFrame } from '@shared/ipc'
import { Camera, Focus, Square, Video, VideoOff } from 'lucide-react'
import { useRef, useState } from 'react'

interface LiveViewPanelProps {
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
    /** The frames the camera draws over live view; empty when it shows none (Wide at rest). */
    /** The camera's on-screen display, drawn over the picture while the overlay is on. */
    osdFrameUrl: string | null
    /** Zebras and focus peaking drawn over the picture by Studio. */
    previewAssists: PreviewAssistSettings
    onCapture: () => void
    onStartRecording: () => void
    onStopRecording: () => void
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

/** Focus, shutter and record, floating over the bottom of the picture. */
function CameraControls(props: CameraControlsProps): React.JSX.Element {
    const { cameraState, disabled } = props
    return (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3">
            <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" disabled={disabled} onClick={props.onFocus} />}>
                    <Focus aria-hidden /> Focus
                </TooltipTrigger>
                <TooltipContent>
                    Autofocus <Kbd>F</Kbd>
                </TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            variant="ghost"
                            className="size-11 rounded-full border-2 border-foreground/85 p-0 hover:border-foreground hover:bg-transparent active:scale-95"
                            disabled={disabled}
                            onClick={props.onCapture}
                            aria-label="Take photo"
                        />
                    }
                >
                    {props.capturing ? (
                        <Spinner className="size-5" />
                    ) : (
                        <span className="size-8 rounded-full bg-foreground" aria-hidden />
                    )}
                </TooltipTrigger>
                <TooltipContent>
                    Take photo <Kbd>Return</Kbd>
                </TooltipContent>
            </Tooltip>

            {cameraState.recording ? (
                <Button variant="destructive" disabled={!cameraState.connected} onClick={props.onStopRecording}>
                    <Square aria-hidden className="fill-current" /> Stop
                </Button>
            ) : (
                <Button variant="ghost" disabled={disabled} onClick={props.onStartRecording}>
                    <Video aria-hidden /> Record
                </Button>
            )}
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

/** The picture itself; the only part of the panel that re-renders with each frame. */
function LiveFrameImage({ dimmed, onAspect }: { dimmed: boolean; onAspect: (aspect: number) => void }) {
    const frame = useLiveFrame()
    if (!frame) return null
    return (
        <img
            onLoad={event => {
                const image = event.currentTarget
                const aspect = image.naturalWidth / image.naturalHeight
                if (Number.isFinite(aspect)) onAspect(aspect)
            }}
            className={`size-full object-contain transition-opacity duration-300 ${dimmed ? 'opacity-40' : ''}`}
            src={frame.url}
            alt="Live view from the camera"
        />
    )
}

export function LiveViewPanel(props: LiveViewPanelProps): React.JSX.Element {
    const { cameraState } = props
    const hasLiveFrame = useHasLiveFrame()
    const focusFrames = useFocusFrames()
    // Fill the panel at the frame's own shape, scaling past its native resolution if needed.
    const [frameAspect, setFrameAspect] = useState(3 / 2)
    const [focusMarker, setFocusMarker] = useState<FocusMarker | null>(null)
    const focusRingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    // The focus frame's size is kept when a click moves it, even while the camera switches areas.
    const lastFocusFrame = useRef<FocusFrame>(DEFAULT_FOCUS_FRAME)
    const currentFocusFrame = focusFrames.find(frame => frame.kind === 'focus')
    // The camera reports faces and eyes in every area, but in a Flexible Spot it focuses on the spot:
    // only show them where the camera picks the subject itself.
    const cameraPicksSubject = !/flexible spot/i.test(cameraState.controls?.focusArea?.value ?? '')
    const shownFrames = cameraPicksSubject
        ? focusFrames
        : focusFrames.filter(frame => frame.kind === 'focus')
    if (currentFocusFrame) lastFocusFrame.current = currentFocusFrame
    const disabled = !cameraState.connected || props.busy || props.locked
    const canFocusAt = props.onFocusAt !== null && !disabled && !props.readingCard
    // While the card is read, live view is paused: keep the last frame, dimmed and labelled, rather than flash.
    const showFrame = cameraState.connected && (cameraState.liveView || props.readingCard) && hasLiveFrame

    return (
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/55 [container-type:size]">
            {showFrame ? (
                <div
                    className={`relative overflow-hidden rounded-md ${canFocusAt ? 'cursor-crosshair!' : ''}`}
                    style={{ aspectRatio: frameAspect, width: `min(100cqw, calc(100cqh * ${frameAspect}))` }}
                    onClick={event => {
                        if (!canFocusAt || !props.onFocusAt) return
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
                    title={canFocusAt ? 'Click to focus there' : undefined}
                >
                    <LiveFrameImage
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
                    {(props.previewAssists.zebras || props.previewAssists.focusPeaking) && !props.readingCard && (
                        <PreviewAssistsOverlay settings={props.previewAssists} />
                    )}
                    {props.osdFrameUrl && (
                        <img
                            className="pointer-events-none absolute inset-0 size-full object-fill"
                            src={props.osdFrameUrl}
                            alt=""
                            draggable={false}
                        />
                    )}
                    {cameraState.recording && (
                        <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] font-semibold tracking-wide text-rec">
                            <span className="size-2 animate-pulse rounded-full bg-rec" aria-hidden /> REC
                        </span>
                    )}
                    {focusMarker ? (
                        <CameraFocusFrame frame={lastFocusFrame.current} marker={focusMarker} />
                    ) : (
                        shownFrames.map((frame, index) => <CameraFocusFrame key={index} frame={frame} />)
                    )}
                    <CameraControls {...props} disabled={disabled} />
                </div>
            ) : null}
            {showFrame && cameraState.recording && (
                // Tally: a neon tube around the picture, outside its clipped corners so the glow can spill.
                <span
                    className="tally pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{ aspectRatio: frameAspect, width: `min(100cqw, calc(100cqh * ${frameAspect}))` }}
                    aria-hidden
                >
                    <TallyComet />
                </span>
            )}
            {showFrame ? null : (
                <>
                    <ViewportPlaceholder
                        cameraState={cameraState}
                        readingCard={props.readingCard}
                        onRetryLiveView={props.onRetryLiveView}
                    />
                    {cameraState.connected && <CameraControls {...props} disabled={disabled} />}
                </>
            )}
        </div>
    )
}
