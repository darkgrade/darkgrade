import { GpuScope } from '@renderer/gpu/GpuScope'
import { WAVEFORM } from '@renderer/gpu/scope-shaders'

/** Live RGB waveform of the camera feed, measured and drawn on the GPU; channels add toward white where they agree. */
export function Waveform({ active }: { active: boolean }): React.JSX.Element {
    return <GpuScope shader={WAVEFORM} active={active} className="h-28" label="Live RGB waveform" />
}
