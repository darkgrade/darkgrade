import {
    Button,
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
    ToggleGroup,
    ToggleGroupItem,
} from '@kevinschaich/components'
import type { CameraControl } from '@shared/ipc'
import { Info } from 'lucide-react'

interface LiveViewStatsProps {
    /** Average frames per second over the last ten seconds; null before any frame. */
    framesPerSecond: number | null
    frameSize: { width: number; height: number } | null
    /** Sony's Live View Image Quality (LOW / HIGH); null when the camera has none. */
    quality: CameraControl | null
    disabled: boolean
    onQualityChange: (value: string) => void
}

const QUALITY_ITEM_CLASS =
    'h-5 rounded-[4px]! px-2 text-[11px] text-muted-foreground hover:bg-transparent hover:text-foreground data-[pressed]:bg-foreground/12 data-[pressed]:text-foreground'

/** Live view's frame rate, resolution and Sony's LQ/HQ switch, at the end of the status bar. */
export function LiveViewStats(props: LiveViewStatsProps): React.JSX.Element | null {
    if (props.framesPerSecond === null && !props.quality) return null
    return (
        <div className="flex shrink-0 items-center gap-3 text-muted-foreground tabular-nums">
            <Popover>
                <PopoverTrigger
                    render={<Button variant="ghost" size="xs" className="-mr-1 gap-1 text-muted-foreground" />}
                >
                    Preview <Info aria-hidden />
                </PopoverTrigger>
                <PopoverContent side="top" align="end" className="w-72">
                    <PopoverHeader>
                        <PopoverTitle>About the preview</PopoverTitle>
                        <PopoverDescription>
                            This is a live preview, not what your camera records. Photos and video are saved at the
                            camera's full resolution. To stream a preview while you control the camera, the camera sends
                            a smaller picture. HQ is sharper; LQ is lighter on the connection. We hope to raise these
                            limits in a future version.
                        </PopoverDescription>
                    </PopoverHeader>
                </PopoverContent>
            </Popover>
            {props.framesPerSecond !== null && (
                <span title="Live view frames per second, averaged over the last 10 seconds">
                    {props.framesPerSecond.toFixed(1)} fps
                </span>
            )}
            {props.frameSize && (
                <span title="Live view resolution">
                    {props.frameSize.width}×{props.frameSize.height}
                </span>
            )}
            {props.quality && (
                <ToggleGroup
                    className="rounded-md bg-foreground/6 p-0.5"
                    spacing={0}
                    size="sm"
                    value={props.quality.value ? [props.quality.value] : []}
                    onValueChange={values => values[0] && props.onQualityChange(values[0])}
                    disabled={props.disabled || !props.quality.enabled}
                    aria-label="Live view quality"
                >
                    <ToggleGroupItem value="LOW" className={QUALITY_ITEM_CLASS}>
                        LQ
                    </ToggleGroupItem>
                    <ToggleGroupItem value="HIGH" className={QUALITY_ITEM_CLASS}>
                        HQ
                    </ToggleGroupItem>
                </ToggleGroup>
            )}
        </div>
    )
}
