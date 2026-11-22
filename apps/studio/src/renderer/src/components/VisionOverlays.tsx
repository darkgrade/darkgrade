import { Input, Switch } from '@kevinschaich/components'
import { formatOverlayRate } from '@renderer/lib/latest-frame-loop'
import {
    overlaysEnabled,
    overlayStates,
    segmentationPrompt,
    setOverlayEnabled,
    visionEngineStatus,
    type OverlayState,
} from '@renderer/lib/vision-overlays'
import { visionModel, type VisionEngineStatus, type VisionModelId } from '@shared/vision-models'

const OVERLAY_LABELS: Record<VisionModelId, string> = {
    'depth-pro-2': 'Depth (Depth Pro 2)',
    sam3: 'Objects (SAM 3)',
}

function overlayRate(state: OverlayState): string | null {
    return formatOverlayRate(state.framesPerSecond, state.roundTripMilliseconds)
}

/** While an overlay waits for its first picture: what its engine is doing. */
function engineProgress(status: VisionEngineStatus | undefined): string {
    if (status?.phase === 'downloading' && status.totalBytes > 0)
        return `Downloading · ${Math.floor((status.receivedBytes / status.totalBytes) * 100)}%`
    if (status?.phase === 'starting') return 'Loading the model…'
    return 'Waiting for the first overlay…'
}

function OverlaySwitch({ id }: { id: VisionModelId }): React.JSX.Element {
    const enabled = overlaysEnabled.useSelect(current => current[id])
    const state = overlayStates[id].use()
    const engine = visionEngineStatus.useSelect(current => current?.[id])
    const rate = overlayRate(state)
    return (
        <div className="flex flex-col gap-1">
            <label
                className="flex items-center justify-between gap-2 leading-none"
                title={`${visionModel(id).name}, live over the picture. ${visionModel(id).licence}`}
            >
                <span className="text-muted-foreground">{OVERLAY_LABELS[id]}</span>
                <Switch checked={enabled} onCheckedChange={on => setOverlayEnabled(id, on)} />
            </label>
            {enabled && state.error && <p className="text-[11px] leading-snug text-destructive">{state.error}</p>}
            {enabled && !state.error && (
                <p className="text-[11px] text-muted-foreground tabular-nums">
                    {rate ? `${rate} · ${state.detail}` : engineProgress(engine)}
                </p>
            )}
        </div>
    )
}

function SegmentationPrompt(): React.JSX.Element {
    const prompt = segmentationPrompt.use()
    return (
        <Input
            className="h-7 text-[12px]"
            value={prompt}
            onChange={event => segmentationPrompt.set(event.target.value)}
            placeholder="What to find, e.g. person"
            aria-label="What SAM 3 looks for"
        />
    )
}

/** Developer Mode's vision overlays in the scopes panel: each switched on alone or together, with its live rate. */
export function VisionOverlayControls(): React.JSX.Element {
    const segmentationOn = overlaysEnabled.useSelect(current => current.sam3)
    return (
        <div className="flex flex-col gap-1.75 border-t border-foreground/8 pt-2">
            <span className="text-[11px] tracking-wide text-muted-foreground/70 uppercase">Vision overlays</span>
            <OverlaySwitch id="depth-pro-2" />
            <OverlaySwitch id="sam3" />
            {segmentationOn && <SegmentationPrompt />}
        </div>
    )
}

function OverlayPicture({ id }: { id: VisionModelId }): React.JSX.Element | null {
    const imageUrl = overlayStates[id].useSelect(current => current.imageUrl)
    if (!imageUrl) return null
    return (
        <img
            className={`absolute inset-0 size-full object-fill ${id === 'depth-pro-2' ? 'opacity-55' : ''}`}
            src={imageUrl}
            alt=""
        />
    )
}

function OverlayReadout({ id }: { id: VisionModelId }): React.JSX.Element | null {
    const state = overlayStates[id].use()
    const rate = overlayRate(state)
    if (!rate) return null
    return (
        <span>
            {visionModel(id).name} {rate}
        </span>
    )
}

/** The overlays over the picture, depth under the instances, with each one's measured rate in the corner. */
export function VisionOverlayLayer(): React.JSX.Element {
    return (
        <>
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[8px]" aria-hidden>
                <OverlayPicture id="depth-pro-2" />
                <OverlayPicture id="sam3" />
            </div>
            <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-0.5 rounded-md bg-black/60 px-2 py-1 text-[11px] text-foreground/85 tabular-nums empty:hidden">
                <OverlayReadout id="depth-pro-2" />
                <OverlayReadout id="sam3" />
            </div>
        </>
    )
}
