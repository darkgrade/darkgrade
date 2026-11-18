import { Button } from '@kevinschaich/components'
import { HoverTip } from '@renderer/components/HoverTip'
import { liveFrameRate, liveFrameSize } from '@renderer/lib/live-frame-store'
import type { CameraControl } from '@shared/ipc'

/** The readouts subscribe on their own, so a new rate re-renders these words alone, not the toolbar. */
function FrameRate(): React.JSX.Element {
    const rate = liveFrameRate.use()
    return <>{rate !== null ? `${rate.toFixed(1)} fps` : '—'}</>
}

function FrameSize(): React.JSX.Element {
    const size = liveFrameSize.use()
    return <>{size ? `${size.width}×${size.height}` : '—'}</>
}

export interface PreviewQualityProps {
    /** Live view is running: the details show its frame rate and size. */
    live: boolean
    /** Sony's Live View Image Quality (LOW / HIGH); null when the camera has none. */
    quality: CameraControl | null
    disabled: boolean
    onQualityChange: (value: string) => void
}

/**
 * The live preview's quality in the toolbar: HQ or LQ as the camera currently sends it, a click switching to the
 * other. Hovering shows what the preview is, with its frame rate and resolution.
 */
export function PreviewQuality(props: PreviewQualityProps & { className: string }): React.JSX.Element | null {
    const { quality } = props
    if (!quality?.value) return null
    const high = quality.value === 'HIGH'
    return (
        <HoverTip
            tip={
                <div className="flex w-72 flex-col gap-2.5 py-1">
                    <p className="font-medium">About the preview</p>
                    <p className="text-muted-foreground">
                        This is a live preview, not what your camera records. Photos and video are saved at the camera's
                        full resolution. To stream a preview while you control the camera, the camera sends a smaller
                        picture. HQ is sharper; LQ is lighter on the connection. Click to switch.
                    </p>
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.75 tabular-nums">
                        <dt className="text-muted-foreground">Quality</dt>
                        <dd className="text-right">{high ? 'HQ' : 'LQ'}</dd>
                        <dt className="text-muted-foreground">Frame rate</dt>
                        <dd className="text-right">{props.live ? <FrameRate /> : '—'}</dd>
                        <dt className="text-muted-foreground">Resolution</dt>
                        <dd className="text-right">{props.live ? <FrameSize /> : '—'}</dd>
                    </dl>
                    <p className="text-[11px] text-muted-foreground">
                        Frame rate is averaged over the last 10 seconds.
                    </p>
                </div>
            }
            render={
                <Button
                    variant="ghost"
                    className={`${props.className} w-auto! px-2! text-[13px] font-semibold tracking-wide`}
                    disabled={props.disabled || !quality.enabled}
                    onClick={() => props.onQualityChange(high ? 'LOW' : 'HIGH')}
                    aria-label={`Preview quality: ${high ? 'HQ' : 'LQ'}. Switch to ${high ? 'LQ' : 'HQ'}`}
                />
            }
        >
            {high ? 'HQ' : 'LQ'}
        </HoverTip>
    )
}
