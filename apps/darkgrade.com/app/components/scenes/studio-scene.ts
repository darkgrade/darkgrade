import { DoubleSide, MathUtils, Mesh, MeshBasicMaterial, RingGeometry } from 'three'

import { ANATOMY } from '@/app/components/scenes/isometric-look'
import type { Model } from '@/app/components/scenes/load-model'
import type { Stage } from '@/app/components/scenes/staging'
import { type Arrangement, type StandingItem, buildStudioSet, onArc, sway } from '@/app/components/scenes/studio-set'

/** Mid set-up: lights going up on one side, the ladder open beside the spotlight, cases by the crate, the director's chair waiting. */
const LOAD_IN: Arrangement = {
    aim: 'stage',
    stageMetres: 3.4,
    placements: [
        onArc('softbox', -55, 2.7, { id: 'softbox' }),
        onArc('parabolicLamp', -22, 3.0, { id: 'parabolicLamp' }),
        onArc('spotlight', 14, 3.1, { id: 'spotlight' }),
        { id: 'ladder', item: 'ladder', across: 1.75, back: 3.3, turnDegrees: 70 },
        { id: 'crate', item: 'crate', across: 2.9, back: 2.2, turnDegrees: -20 },
        { id: 'crateCase', item: 'case', across: 2.85, back: 2.2, raised: 1.08, turnDegrees: 10 },
        { id: 'lowerCase', item: 'case', across: 2.35, back: 1.25, turnDegrees: 35 },
        { id: 'upperCase', item: 'case', across: 2.38, back: 1.27, raised: 0.18, turnDegrees: 20 },
        { id: 'cableReel', item: 'cableReel', across: 0.5, back: 2.2, turnDegrees: 60 },
        { id: 'floorLamp', item: 'floorLamp', across: -0.6, back: 1.8 },
        { id: 'chair', item: 'chair', across: -0.15, back: 4.1 },
    ],
}

/** The copies that turn to follow the mark: the four lights, and the chair, which watches. */
const FOLLOWERS = ['softbox', 'parabolicLamp', 'spotlight', 'floorLamp', 'chair']
/** The items whose head turns on its stand; the others turn bodily. */
const PANNING_ITEMS = ['softbox', 'spotlight', 'parabolicLamp']
const MARK_RADIUS_MILLIMETRES = 170
const MARK_HEIGHT_MILLIMETRES = 3
/** The mark circles the stage, swinging in towards the middle and out to near the rim as it goes. */
const MARK_NEAREST_MILLIMETRES = 250
const MARK_FARTHEST_MILLIMETRES = 1500
const MARK_RADIANS_PER_SECOND = 0.85
const MARK_SWINGS_PER_SECOND = 1.9
/** A light tips down at a mark close by and up at one far off: this much, in radians, a metre either side of the middle distance. */
const TIP_PER_METRE = 0.16
const MIDDLE_DISTANCE_MILLIMETRES = 2900
const MOST_TIP_RADIANS = 0.32

/** Turns a copy to face a point on the floor, by its pan joint if it has one and bodily if not. */
function faceThePoint(item: StandingItem, acrossMillimetres: number, backMillimetres: number) {
    const towards = Math.atan2(acrossMillimetres - item.home.x, backMillimetres - item.home.z)
    const turn = MathUtils.euclideanModulo(towards - item.homeTurn + Math.PI, Math.PI * 2) - Math.PI
    if (PANNING_ITEMS.includes(item.placement.item)) item.rig.pose.pan = turn
    else item.rig.root.rotation.y = item.homeTurn + turn
    const away = Math.hypot(acrossMillimetres - item.home.x, backMillimetres - item.home.z)
    item.rig.pose.tilt = MathUtils.clamp(((away - MIDDLE_DISTANCE_MILLIMETRES) / 1000) * TIP_PER_METRE, -MOST_TIP_RADIANS, MOST_TIP_RADIANS)
}

/** Studio: a mark sweeps round the stage and every light turns and tips to keep it lit. */
export function studioScene(model: Model): Stage {
    const set = buildStudioSet(model, LOAD_IN)
    const followers = FOLLOWERS.map(id => set.byId(id))
    const mark = new Mesh(new RingGeometry(0.7, 1, 40), new MeshBasicMaterial({ color: ANATOMY.lit, transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false }))
    mark.rotation.x = -Math.PI / 2
    mark.position.y = MARK_HEIGHT_MILLIMETRES
    mark.scale.setScalar(MARK_RADIUS_MILLIMETRES)
    set.gear.add(mark)

    return {
        scene: set.staging.scene,
        camera: set.staging.camera,
        target: set.staging.target,
        update(seconds) {
            const swing = (1 + Math.sin(seconds * MARK_SWINGS_PER_SECOND)) / 2
            const out = MathUtils.lerp(MARK_NEAREST_MILLIMETRES, MARK_FARTHEST_MILLIMETRES, swing)
            const across = out * Math.cos(seconds * MARK_RADIANS_PER_SECOND)
            const back = out * Math.sin(seconds * MARK_RADIANS_PER_SECOND)
            sway(set, seconds)
            set.rest()
            mark.position.x = across
            mark.position.z = back
            for (const follower of followers) faceThePoint(follower, across, back)
            set.update()
        },
    }
}
