import { Box3, BufferGeometry, Float32BufferAttribute, Group, LineSegments, MathUtils, Vector3 } from 'three'

import { ANATOMY, ISOMETRIC_ELEVATION_DEGREES, ISOMETRIC_FIELD_OF_VIEW_DEGREES, dotGrid, isometricLayers } from '@/app/components/scenes/isometric-look'
import type { Model, ModelPiece } from '@/app/components/scenes/load-model'
import { lineMaterial } from '@/app/components/scenes/materials'
import { type Staging, createStaging, placeCamera } from '@/app/components/scenes/staging'
import { type ItemRig, createItemRig } from '@/app/components/scenes/studio-rig'

/** The nine items of the studio kit, as studio.bin names them. Each stands at the origin facing +z. */
export type StudioItem = 'softbox' | 'spotlight' | 'floorLamp' | 'parabolicLamp' | 'chair' | 'case' | 'crate' | 'ladder' | 'cableReel'

/** Where one copy of an item stands, in metres from the middle of the stage. The gear stands on the +back side. */
export interface Placement {
    /** What an animation calls this copy. */
    id?: string
    item: StudioItem
    across: number
    back: number
    /** Degrees turned to its left from where the arrangement aims it. */
    turnDegrees?: number
    /** Metres off the floor, for things stood on other things. */
    raised?: number
}

export interface Arrangement {
    /** Whether every item turns to face the middle of the stage, or all face the same way. */
    aim: 'stage' | 'ahead'
    /** The side of the square stage's floor mark, in metres, or none. */
    stageMetres?: number
    placements: Placement[]
}

/** One copy of an item standing on the set, with where it belongs. */
export interface StandingItem {
    placement: Placement
    rig: ItemRig
    /** Its place among the gear, in millimetres, and the way it faces there, in radians. */
    home: Vector3
    homeTurn: number
}

export interface StudioSet {
    staging: Staging
    /** Everything that sways together. */
    turntable: Group
    /** The gear, in whose frame placements are measured: x across, z back from the middle of the stage. */
    gear: Group
    items: StandingItem[]
    byId(id: string): StandingItem
    /** Puts every copy back where it belongs, unposed, with its light on. */
    rest(): void
    /** Applies every copy's pose. */
    update(): void
}

export const MILLIMETRES_PER_METRE = 1000
const DOT_SPACING_MILLIMETRES = 500
/** The gear stands beyond the far corner of the stage, facing the viewer across it. */
const GEAR_HEADING_RADIANS = Math.PI / 4
/** How much wider than tall a card is, at its narrowest. */
const NARROWEST_ASPECT = 4 / 3
/** Room left around the set, as a share of what it fills: enough for its sway. */
const FRAMING_MARGIN = 1.16
const CAMERA_AZIMUTH_DEGREES = 225
const STAGE_MARK_HEIGHT_MILLIMETRES = 2
const SWAY_RADIANS = 0.3
const SWAY_RADIANS_PER_SECOND = 0.22

/** A point on a circle about the middle of the stage: `degrees` round from straight back, `metres` out. */
export function onArc(item: StudioItem, degrees: number, metres: number, more: Partial<Placement> = {}): Placement {
    const angle = MathUtils.degToRad(degrees)
    return { item, across: metres * Math.sin(angle), back: metres * Math.cos(angle), ...more }
}

function stageMark(sideMetres: number): LineSegments {
    const half = (sideMetres / 2) * MILLIMETRES_PER_METRE
    const y = STAGE_MARK_HEIGHT_MILLIMETRES
    const corners = [-half, y, -half, half, y, -half, half, y, half, -half, y, half]
    const outline = [0, 1, 1, 2, 2, 3, 3, 0].flatMap(corner => corners.slice(corner * 3, corner * 3 + 3))
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(outline, 3))
    return new LineSegments(geometry, lineMaterial(ANATOMY.lit, 0.8))
}

function groupByItem(pieces: ModelPiece[]): Map<string, ModelPiece[]> {
    const items = new Map<string, ModelPiece[]>()
    for (const piece of pieces) items.set(piece.group, [...(items.get(piece.group) ?? []), piece])
    return items
}

/** The set's slow turn to and fro, for cards that do not move the camera themselves. */
export function sway(set: StudioSet, seconds: number) {
    set.turntable.rotation.y = Math.sin(seconds * SWAY_RADIANS_PER_SECOND) * SWAY_RADIANS
}

const boxCorner = new Vector3()

/**
 * Points the isometric camera so these boxes fill the view. `swingRoom` is how far, in
 * millimetres, anything stands from the middle of the set: the depth the camera must see through
 * as the set sways.
 */
function frame(staging: Staging, boxes: Box3[], swingRoom: number) {
    placeCamera(staging.camera, new Vector3(), 1, CAMERA_AZIMUTH_DEGREES, ISOMETRIC_ELEVATION_DEGREES)
    staging.camera.updateMatrixWorld(true)
    const right = new Vector3().setFromMatrixColumn(staging.camera.matrixWorld, 0)
    const up = new Vector3().setFromMatrixColumn(staging.camera.matrixWorld, 1)
    let [left, rightmost, bottom, top] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const box of boxes) {
        for (let corner = 0; corner < 8; corner++) {
            boxCorner.set(corner & 1 ? box.max.x : box.min.x, corner & 2 ? box.max.y : box.min.y, corner & 4 ? box.max.z : box.min.z)
            left = Math.min(left, boxCorner.dot(right))
            rightmost = Math.max(rightmost, boxCorner.dot(right))
            bottom = Math.min(bottom, boxCorner.dot(up))
            top = Math.max(top, boxCorner.dot(up))
        }
    }
    const halfSeen = Math.max((rightmost - left) / 2 / NARROWEST_ASPECT, (top - bottom) / 2) * FRAMING_MARGIN
    const distance = halfSeen / Math.tan(MathUtils.degToRad(ISOMETRIC_FIELD_OF_VIEW_DEGREES / 2))
    staging.target.set(0, 0, 0).addScaledVector(right, (left + rightmost) / 2).addScaledVector(up, (bottom + top) / 2)
    staging.camera.near = distance - swingRoom * 3
    staging.camera.far = distance + swingRoom * 3
    placeCamera(staging.camera, staging.target, distance, CAMERA_AZIMUTH_DEGREES, ISOMETRIC_ELEVATION_DEGREES)
}

/** Stands an arrangement's gear around its stage and frames it in the isometric view. */
export function buildStudioSet(model: Model, arrangement: Arrangement): StudioSet {
    const staging = createStaging(ISOMETRIC_FIELD_OF_VIEW_DEGREES)
    const piecesOf = groupByItem(model.pieces)
    const layers = isometricLayers()
    const gear = new Group()
    gear.rotation.y = GEAR_HEADING_RADIANS

    const items: StandingItem[] = arrangement.placements.map(placement => {
        const rig = createItemRig(piecesOf.get(placement.item) ?? [], model.joints.filter(joint => joint.item === placement.item), layers)
        const home = new Vector3(placement.across, placement.raised ?? 0, placement.back).multiplyScalar(MILLIMETRES_PER_METRE)
        const towards = arrangement.aim === 'stage' ? Math.atan2(-placement.across, -placement.back) : Math.PI
        gear.add(rig.root)
        return { placement, rig, home, homeTurn: towards + MathUtils.degToRad(placement.turnDegrees ?? 0) }
    })

    const set: StudioSet = {
        staging,
        turntable: new Group(),
        gear,
        items,
        byId(id) {
            const found = items.find(item => item.placement.id === id)
            if (!found) throw new Error(`The set has no copy called ${id}`)
            return found
        },
        rest() {
            for (const item of items) {
                item.rig.root.position.copy(item.home)
                item.rig.root.rotation.y = item.homeTurn
                item.rig.root.visible = true
                for (const joint of Object.keys(item.rig.pose)) item.rig.pose[joint] = 0
                item.rig.lit = true
                item.rig.highlighted = false
            }
        },
        update() {
            for (const item of items) item.rig.update()
        },
    }
    set.rest()

    const standing = new Group()
    standing.add(gear)
    if (arrangement.stageMetres) standing.add(stageMark(arrangement.stageMetres))

    // The set sways about the middle of everything standing on it.
    standing.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(standing)
    const centre = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    const reach = Math.hypot(size.x, size.z) / 2
    standing.position.set(-centre.x, 0, -centre.z)
    set.turntable.add(standing, dotGrid(0, DOT_SPACING_MILLIMETRES, Math.ceil((reach * 1.15) / DOT_SPACING_MILLIMETRES)))
    staging.scene.add(set.turntable)
    set.turntable.updateMatrixWorld(true)

    const boxes = items.map(item => new Box3().setFromObject(item.rig.root))
    if (arrangement.stageMetres) boxes.push(new Box3().setFromObject(standing.children[1]))
    frame(staging, boxes, reach)
    return set
}
