import { Button } from '@kevinschaich/components'
import { HoverTip } from '@renderer/components/HoverTip'
import type { CameraControl } from '@shared/ipc'

export interface PreviewQualityProps {
    /** Average frames per second over the last ten seconds; null before any frame. */
    framesPerSecond: number | null
    frameSize: { width: number; height: number } | null
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
                        <dd className="text-right">
                            {props.framesPerSecond !== null ? `${props.framesPerSecond.toFixed(1)} fps` : '—'}
                        </dd>
                        <dt className="text-muted-foreground">Resolution</dt>
                        <dd className="text-right">
                            {props.frameSize ? `${props.frameSize.width}×${props.frameSize.height}` : '—'}
                        </dd>
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
