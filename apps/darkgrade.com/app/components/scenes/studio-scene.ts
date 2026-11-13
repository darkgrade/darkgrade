import { DoubleSide, MathUtils, Mesh, MeshBasicMaterial, RingGeometry } from 'three'

import { ANATOMY } from '@/app/components/scenes/isometric-look'
import type { Model } from '@/app/components/scenes/load-model'
import type { Stage } from '@/app/components/scenes/staging'
import { type Arrangement, type StandingItem, buildStudioSet, onArc, sway } from '@/app/components/scenes/studio-set'

/** Mid set-up: lights going up on one side, the ladder open beside the spotlight, cases by the crate, the director's chair waiting. */
const LOAD_IN: Arrangement = {
    aim: 'stage',
    stageMetres: 2.6,
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
const MARK_RADIUS_MILLIMETRES = 110
const MARK_HEIGHT_MILLIMETRES = 3
const MARK_REACH_ACROSS_MILLIMETRES = 950
const MARK_REACH_BACK_MILLIMETRES = 650

/** Turns a copy to face a point on the floor, by its pan joint if it has one and bodily if not. */
function faceThePoint(item: StandingItem, acrossMillimetres: number, backMillimetres: number) {
    const towards = Math.atan2(acrossMillimetres - item.home.x, backMillimetres - item.home.z)
    const turn = MathUtils.euclideanModulo(towards - item.homeTurn + Math.PI, Math.PI * 2) - Math.PI
    if (PANNING_ITEMS.includes(item.placement.item)) item.rig.pose.pan = turn
    else item.rig.root.rotation.y = item.homeTurn + turn
}

/** Studio: a mark wanders the stage and every light turns to keep it lit. */
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
        update(seconds) {
            const across = MARK_REACH_ACROSS_MILLIMETRES * Math.sin(seconds * 0.7)
            const back = MARK_REACH_BACK_MILLIMETRES * Math.sin(seconds * 1.4)
            sway(set, seconds)
            set.rest()
            mark.position.x = across
            mark.position.z = back
            for (const follower of followers) faceThePoint(follower, across, back)
            set.update()
        },
    }
}
