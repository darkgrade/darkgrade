import { Button } from '@kevinschaich/components'
import { ControlRow } from '@renderer/components/ControlRow'
import { InspectorSection } from '@renderer/components/InspectorSection'
import type { CameraControlName, CameraState } from '@shared/ipc'
import { ZoomIn, ZoomOut } from 'lucide-react'

interface LensPanelProps {
    cameraState: CameraState
    locked: boolean
    onZoomStart: (direction: 'wide' | 'tele') => void
    onZoomStop: () => void
    onChange: (name: CameraControlName, value: string) => void
}

/** "24 mm", "70.5 mm". */
export function formatFocalLength(millimetres: number): string {
    return `${Number.isInteger(millimetres) ? millimetres : millimetres.toFixed(1)} mm`
}

export function LensPanel({
    cameraState,
    locked,
    onZoomStart,
    onZoomStop,
    onChange,
}: LensPanelProps): React.JSX.Element {
    const lens = cameraState.lens
    const disabled = !cameraState.connected || locked
    // The camera says whether remote zoom can drive this lens in this mode, and why not.
    const zoomUnavailable = lens?.zoom.supported === false
    const zoomTitle = zoomUnavailable ? (lens?.zoom.reason ?? 'Zoom isn’t available on this camera') : undefined
    const zoomDisabled = disabled || zoomUnavailable
    return (
        <InspectorSection title="Lens" collapsible defaultOpen>
            {cameraState.connected ? (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">{lens?.name ?? 'Unknown lens'}</span>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                                {lens?.focalLengthMillimetres != null
                                    ? formatFocalLength(lens.focalLengthMillimetres)
                                    : 'Focal length not reported'}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                disabled={zoomDisabled}
                                title={zoomTitle}
                                aria-label="Zoom out (hold)"
                                onPointerDown={event => {
                                    event.currentTarget.setPointerCapture(event.pointerId)
                                    onZoomStart('wide')
                                }}
                                onPointerUp={onZoomStop}
                                onPointerCancel={onZoomStop}
                                onLostPointerCapture={onZoomStop}
                            >
                                <ZoomOut />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                disabled={zoomDisabled}
                                title={zoomTitle}
                                aria-label="Zoom in (hold)"
                                onPointerDown={event => {
                                    event.currentTarget.setPointerCapture(event.pointerId)
                                    onZoomStart('tele')
                                }}
                                onPointerUp={onZoomStop}
                                onPointerCancel={onZoomStop}
                                onLostPointerCapture={onZoomStop}
                            >
                                <ZoomIn />
                            </Button>
                        </div>
                    </div>
                    {cameraState.controls && (
                        <ControlRow
                            label="Digital zoom"
                            control={cameraState.controls.digitalZoom}
                            disabled={disabled}
                            onChange={value => onChange('digitalZoom', value)}
                        />
                    )}
                </div>
            ) : (
                <p className="text-muted-foreground">Connect a camera to see its lens.</p>
            )}
        </InspectorSection>
    )
}
