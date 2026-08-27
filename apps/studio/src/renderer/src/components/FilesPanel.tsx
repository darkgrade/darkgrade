import type { CameraState, DownloadProgress, FileEntry } from '@shared/ipc'

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface FilesPanelProps {
    cameraState: CameraState
    files: FileEntry[]
    loading: boolean
    downloadProgress: DownloadProgress | null
    onRefresh: () => void
    onDownload: (entry: FileEntry) => void
    onDownloadAll: () => void
    onChooseDir: () => void
    onRevealDir: () => void
}

export function FilesPanel(props: FilesPanelProps): React.JSX.Element {
    const disabled = !props.cameraState.connected

    return (
        <div className="panel files-panel">
            <div className="panel-header">
                <h2>Camera storage</h2>
                <div className="panel-header-actions">
                    <button
                        className="button button-small button-ghost"
                        disabled={disabled || props.loading}
                        onClick={props.onRefresh}
                    >
                        {props.loading ? 'Loading…' : 'Refresh'}
                    </button>
                    <button
                        className="button button-small"
                        disabled={disabled || props.files.length === 0}
                        onClick={props.onDownloadAll}
                    >
                        Download all
                    </button>
                </div>
            </div>

            {props.downloadProgress && (
                <div className="download-progress">
                    <div
                        className="download-progress-bar"
                        style={{ width: `${(props.downloadProgress.completed / props.downloadProgress.total) * 100}%` }}
                    />
                    <span className="download-progress-text">
                        {props.downloadProgress.completed}/{props.downloadProgress.total}{' '}
                        {props.downloadProgress.currentFilename}
                    </span>
                </div>
            )}

            <div className="files-list">
                {props.files.length === 0 ? (
                    <div className="files-empty">
                        {disabled
                            ? 'Connect a camera to browse files'
                            : 'Press Refresh to list files (pauses live view briefly)'}
                    </div>
                ) : (
                    <table className="files-table">
                        <thead>
                            <tr>
                                <th>File</th>
                                <th>Size</th>
                                <th>Date</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {props.files.map(entry => (
                                <tr key={`${entry.storageId}-${entry.objectHandle}`}>
                                    <td className="files-name" title={entry.format}>
                                        {entry.filename}
                                    </td>
                                    <td>{formatBytes(entry.sizeBytes)}</td>
                                    <td className="files-date">{entry.captureDate}</td>
                                    <td>
                                        <button className="button button-small" onClick={() => props.onDownload(entry)}>
                                            ↓
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <div className="files-footer">
                <span className="files-dir" title={props.cameraState.downloadDir}>
                    → {props.cameraState.downloadDir}
                </span>
                <button className="link-button" onClick={props.onChooseDir}>
                    Change
                </button>
                <button className="link-button" onClick={props.onRevealDir}>
                    Open
                </button>
            </div>
        </div>
    )
}
