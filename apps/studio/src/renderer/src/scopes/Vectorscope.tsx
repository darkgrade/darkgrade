import { GpuScope } from '@renderer/gpu/GpuScope'
import { VECTORSCOPE, VECTORSCOPE_LABELS, VECTORSCOPE_TARGETS } from '@renderer/gpu/scope-shaders'

/** Live vectorscope of the camera feed with Resolve's targets and skin-tone line, measured and drawn on the GPU. */
export function Vectorscope({ active }: { active: boolean }): React.JSX.Element {
    return (
        <GpuScope shader={VECTORSCOPE} active={active} className="aspect-square" label="Live vectorscope">
            {/* The target names, 13px outside each target; the circle's radius is the box's half less 6px. */}
            {VECTORSCOPE_TARGETS.map(([cb, cr], index) => {
                const x = cb / 0.5
                const y = cr / 0.5
                const length = Math.hypot(x, y) || 1
                return (
                    <span
                        key={VECTORSCOPE_LABELS[index]}
                        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-[9px] text-foreground/35"
                        style={{
                            left: `calc(50% + (50% - 6px) * ${x.toFixed(4)} + ${((13 * x) / length).toFixed(2)}px)`,
                            top: `calc(50% - (50% - 6px) * ${y.toFixed(4)} - ${((13 * y) / length).toFixed(2)}px)`,
                        }}
                    >
                        {VECTORSCOPE_LABELS[index]}
                    </span>
                )
            })}
        </GpuScope>
    )
}
