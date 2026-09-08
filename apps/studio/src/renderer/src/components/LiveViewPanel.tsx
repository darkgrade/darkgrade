import type { CameraState, CaptureResult } from '@shared/ipc'

interface LiveViewPanelProps {
    cameraState: CameraState
    liveFrameUrl: string | null
    lastCapture: CaptureResult | null
    capturePreviewUrl: string | null
    busy: boolean
    onRetryLiveView: () => void
    onFocus: () => void
    onCapture: () => void
    onStartRecording: () => void
    onStopRecording: () => void
    onRevealCapture: (path: string) => void
}

export function LiveViewPanel(props: LiveViewPanelProps): React.JSX.Element {
    const { cameraState, liveFrameUrl, lastCapture, capturePreviewUrl } = props
    const disabled = !cameraState.connected || props.busy

    return (
        <div className="panel liveview-panel">
            <div className="viewport">
                {cameraState.connected && liveFrameUrl ? (
                    <img className="viewport-frame" src={liveFrameUrl} alt="Live view" />
                ) : (
                    <div className="viewport-empty">
                        {!cameraState.connected && 'Plug in a camera — it connects automatically'}
                        {cameraState.connected && cameraState.liveView && 'Starting live view…'}
                        {cameraState.connected && !cameraState.liveView && (
                            <span>
                                Live view unavailable — captures still work.{' '}
                                <button className="link-button" onClick={props.onRetryLiveView}>
                                    Retry
                                </button>
                            </span>
                        )}
                    </div>
                )}
                {cameraState.recording && <span className="viewport-rec">● REC</span>}
            </div>

            <div className="liveview-controls">
                <button className="button" disabled={disabled} onClick={props.onFocus} title="Half-press autofocus">
                    AF
                </button>

                <button className="shutter-button" disabled={disabled} onClick={props.onCapture} title="Capture image">
                    <span className="shutter-inner" />
                </button>

                {cameraState.recording ? (
                    <button
                        className="button button-danger"
                        disabled={!cameraState.connected}
                        onClick={props.onStopRecording}
                    >
                        Stop recording
                    </button>
                ) : (
                    <button className="button" disabled={disabled} onClick={props.onStartRecording}>
                        Record
                    </button>
                )}
            </div>

            {lastCapture && (
                <div className="last-capture">
                    {capturePreviewUrl && (
                        <img className="last-capture-thumb" src={capturePreviewUrl} alt={lastCapture.filename} />
                    )}
                    <div className="last-capture-meta">
                        <div className="last-capture-name">{lastCapture.filename}</div>
                        <button className="link-button" onClick={() => props.onRevealCapture(lastCapture.savedPath)}>
                            Reveal in Finder
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
