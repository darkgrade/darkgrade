import { Group } from 'three'

import { BODY_CENTRE, createCameraRig } from '@/app/components/scenes/camera-rig'
import { ISOMETRIC_ELEVATION_DEGREES, ISOMETRIC_FIELD_OF_VIEW_DEGREES, dotGrid, halo, isometricLayers } from '@/app/components/scenes/isometric-look'
import type { Model } from '@/app/components/scenes/load-model'
import { type Stage, centreOn, createStaging, placeCamera, rise } from '@/app/components/scenes/staging'

const CAMERA_DISTANCE_MILLIMETRES = 4800
const CAMERA_AZIMUTH_DEGREES = 225
const LOOK_AT_HEIGHT_MILLIMETRES = 112
/** How far the camera's back sits below the middle of its body when it lies lens-up. */
const BACK_BELOW_CENTRE_MILLIMETRES = 43
const DOT_SPACING_MILLIMETRES = 16
const DOT_GRID_HALF_COUNT = 16
const HALO_SIZE_MILLIMETRES = 420
const LOOP_SECONDS = 9

/** Link: the camera lies on its back, its lens lifts off the mount and turns, and its glass draws apart. */
export function linkScene(model: Model): Stage {
    const staging = createStaging(ISOMETRIC_FIELD_OF_VIEW_DEGREES)
    const layers = isometricLayers()
    const rig = createCameraRig(model, piece => (piece.surface === 'element' ? layers.gold(piece) : layers.plain(piece)))
    centreOn(rig.root, BODY_CENTRE)
    const lyingDown = new Group()
    lyingDown.position.copy(BODY_CENTRE)
    lyingDown.rotation.x = -Math.PI / 2
    lyingDown.add(rig.root)

    const groundY = BODY_CENTRE.y - BACK_BELOW_CENTRE_MILLIMETRES - BODY_CENTRE.z
    staging.scene.add(halo(groundY, HALO_SIZE_MILLIMETRES), dotGrid(groundY, DOT_SPACING_MILLIMETRES, DOT_GRID_HALF_COUNT), lyingDown)
    staging.target.set(0, LOOK_AT_HEIGHT_MILLIMETRES, 0)
    placeCamera(staging.camera, staging.target, CAMERA_DISTANCE_MILLIMETRES, CAMERA_AZIMUTH_DEGREES, ISOMETRIC_ELEVATION_DEGREES)

    return {
        scene: staging.scene,
        camera: staging.camera,
        update(seconds) {
            const time = seconds % LOOP_SECONDS
            const lift = rise(time, 0.6, 2.6, 6, 8)
            rig.pose.lensDetach = lift * 0.55
            rig.pose.lensTwist = -1.05 * lift
            rig.pose.zoomRing = lift * 1.2
            rig.pose.glassSpread = rise(time, 2.4, 3.8, 5, 6.2) * 0.5
            rig.update()
        },
    }
}
