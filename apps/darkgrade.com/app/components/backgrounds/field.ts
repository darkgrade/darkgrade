/**
 * One seed and one clock behind both backgrounds.
 *
 * The two renderers do not sample the same field: the silk runs 2D simplex
 * noise in GLSL, the contours run classic 3D Perlin in JS. Different lattices,
 * different gradient tables - no seed can make them look correlated. What the
 * shared seed does buy is that both are deterministic across reloads (the
 * Perlin library otherwise builds its permutation table from Math.random() the
 * first time it is called, so the old background was a different drawing every
 * page load), and that re-rolling this one number re-rolls both together.
 */
export const NOISE_SEED = 0

/**
 * PARKED. The topographic backdrop and the header switch that cross-fades to
 * it are built, typed and covered by the build - they are just not mounted.
 * Flip this to true to bring back the canvas, the toggle and the crossfade;
 * nothing else needs touching.
 */
export const CONTOUR_BACKGROUND_ENABLED = false

const frac = (x: number) => x - Math.floor(x)

/**
 * Which region of its field the silk sits in. Zero leaves the silk exactly as
 * it looks today; any other seed moves it somewhere else in the same noise.
 */
export const SILK_SEED_OFFSET: readonly [number, number] =
    NOISE_SEED === 0
        ? [0, 0]
        : [frac(Math.sin(NOISE_SEED) * 43758.5453) * 128, frac(Math.sin(NOISE_SEED + 1.37) * 24634.6345) * 128]

/**
 * The contour layer's z advance per SECOND. The original accumulated 0.00025
 * per frame, which tied its speed to the refresh rate and made its phase a
 * function of frames drawn rather than time elapsed. Off the shared clock its
 * phase is a pure function of t, so it can be paused while faded out and
 * resumed at exactly the phase it would have reached.
 */
export const CONTOUR_Z_RATE = 0.00025 * 60

/** Seconds a switch takes. Both layers render live for the whole crossfade. */
export const CROSSFADE_SECONDS = 0.55

/** The contour layer's opacity when it is the active background. */
export const CONTOUR_OPACITY = 0.2

/** Grid pitch for the contour layer, in CSS px. Lower = denser, slower. */
export const CONTOUR_RES = 8
