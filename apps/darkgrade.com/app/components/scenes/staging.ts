import { type Group, MathUtils, PerspectiveCamera, Scene, Vector3 } from 'three'

/** What a scene hands the canvas: something to draw, its camera, and how to move both to a moment in time. */
export interface Stage {
    scene: Scene
    camera: PerspectiveCamera
    update(seconds: number): void
}

export interface Staging {
    scene: Scene
    camera: PerspectiveCamera
    /** The point the camera looks at. */
    target: Vector3
}

const NEAR_MILLIMETRES = 10
const FAR_MILLIMETRES = 9000

/** An empty scene with no background of its own, so the page shows through around the drawing. */
export function createStaging(fieldOfViewDegrees: number): Staging {
    return { scene: new Scene(), camera: new PerspectiveCamera(fieldOfViewDegrees, 4 / 3, NEAR_MILLIMETRES, FAR_MILLIMETRES), target: new Vector3() }
}

/** Puts the camera `distance` from `target`, `azimuthDegrees` round from +z and `elevationDegrees` up, looking at it. */
export function placeCamera(camera: PerspectiveCamera, target: Vector3, distance: number, azimuthDegrees: number, elevationDegrees: number) {
    const azimuth = MathUtils.degToRad(azimuthDegrees)
    const elevation = MathUtils.degToRad(elevationDegrees)
    camera.position.set(
        target.x + distance * Math.sin(azimuth) * Math.cos(elevation),
        target.y + distance * Math.sin(elevation),
        target.z + distance * Math.cos(azimuth) * Math.cos(elevation),
    )
    camera.lookAt(target)
}

/** Moves a group so that `centre` sits at its origin, where a parent can turn it about that point. */
export function centreOn(group: Group, centre: Vector3) {
    group.position.copy(centre).negate()
}

export function smooth(value: number): number {
    const clamped = MathUtils.clamp(value, 0, 1)
    return clamped * clamped * (3 - 2 * clamped)
}

/** 0 before `start`, 1 after `end`, eased in between. */
export function between(time: number, start: number, end: number): number {
    return smooth((time - start) / (end - start))
}

/** Rises 0 to 1 over `start`..`peak`, holds, then falls back over `fall`..`end`. */
export function rise(time: number, start: number, peak: number, fall: number, end: number): number {
    return between(time, start, peak) * (1 - between(time, fall, end))
}
