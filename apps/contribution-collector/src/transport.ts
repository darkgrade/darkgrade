import type {CameraContext, DiagnosticEntry} from '@darkgrade/contribute/schema'

/** Normalize the query/export projection; the integrity-checked source payload stays immutable. */
export function cameraConnection(camera:CameraContext,entries:DiagnosticEntry[]):CameraContext {
    const vendor= camera.transport==='sony-sdk' || entries.some(entry=>entry.operation!==undefined)
    const transport=camera.transport==='sony-sdk'
        ? entries.some(entry=>['connect_wifi','connect_bluetooth_direct'].includes(entry.operation||''))?'wifi':'unknown'
        : camera.transport
    return {...camera,transport,backend:camera.backend||(vendor?'vendor-api':'ptp')}
}
