declare module '@chriscourses/perlin-noise' {
    /** Classic Perlin noise, 1D/2D/3D, in the 0..1 range. */
    export function noise(x: number, y?: number, z?: number): number
    /** Seeds the permutation table. Without it the table comes from Math.random(). */
    export function noiseSeed(seed: number): void
    export function noiseDetail(lod: number, falloff: number): void
}
