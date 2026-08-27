import brandLogo from '@renderer/assets/darkgrade_combo_dark.svg'
import type { CameraState } from '@shared/ipc'

interface TopBarProps {
    cameraState: CameraState
    busy: boolean
    voiceListening: boolean
    onConnect: () => void
    onDisconnect: () => void
    onKillDaemon: () => void
}

export function TopBar({
    cameraState,
    busy,
    voiceListening,
    onConnect,
    onDisconnect,
    onKillDaemon,
}: TopBarProps): React.JSX.Element {
    return (
        <header className="topbar">
            <div className="topbar-brand">
                <img className="brand-logo" src={brandLogo} alt="Darkgrade" />
                <span className="brand-sub">STUDIO</span>
            </div>
            <div className="topbar-status">
                <span className={`status-dot ${cameraState.connected ? 'status-dot-on' : ''}`} />
                <span className="status-text">
                    {cameraState.connected ? `${cameraState.vendor ?? 'Camera'} connected` : 'No camera'}
                </span>
                {cameraState.recording && <span className="badge badge-rec">● REC</span>}
                {voiceListening && <span className="badge badge-voice">🎙 listening</span>}
            </div>
            <div className="topbar-actions">
                {cameraState.platform === 'darwin' && (
                    <button
                        className="button button-ghost"
                        title="Kill macOS PTPCamera/ptpcamerad if it hijacked the camera"
                        onClick={onKillDaemon}
                    >
                        Free camera
                    </button>
                )}
                {cameraState.connected ? (
                    <button className="button" disabled={busy} onClick={onDisconnect}>
                        Disconnect
                    </button>
                ) : (
                    <button className="button button-primary" disabled={busy} onClick={onConnect}>
                        Connect
                    </button>
                )}
            </div>
        </header>
    )
}
