import { GpuScope } from '@renderer/gpu/GpuScope'
import { HISTOGRAM } from '@renderer/gpu/scope-shaders'

/** Live RGB histogram of the camera feed, measured and drawn on the GPU, eased between frames. */
export function Histogram({ active }: { active: boolean }): React.JSX.Element {
    return <GpuScope shader={HISTOGRAM} active={active} className="h-24" label="Live RGB histogram" />
}
