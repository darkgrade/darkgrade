import { Box3, BufferGeometry, Group, Matrix4, type Object3D, Vector3 } from 'three'

import type { Model, ModelPiece } from '@/app/components/scenes/load-model'
import { islandsOf } from '@/app/components/scenes/mesh-islands'

/** Everything on the camera that can move. Angles are radians, lengths millimetres, the rest 0 to 1. */
export interface CameraPose {
    explode: number
    lensDetach: number
    lensTwist: number
    zoomExtension: number
    focusRing: number
    zoomRing: number
    apertureRing: number
    glassSpread: number
    glassLift: number
    screenFlip: number
    screenSwivel: number
    modeDial: number
    rearDial: number
    exposureDial: number
    controlWheel: number
    /** 0..1: every key pressed at once. */
    keysPress: number
    /** 0..1: how hard the keys are pressed one at a time, each to a beat of its own, and the clock those beats are counted on, in seconds. */
    keysBusy: number
    keysBusySeconds: number
    /** 0..1: how far down the shutter button is. */
    shutterPress: number
}

export interface RigPiece {
    piece: ModelPiece
    group: Group
    explodeOffset: Vector3
    /** Where this piece sits along the lens axis, 0 at the mount and 1 at the front; -1 off the lens. */
    lensFraction: number
    /** The way a button comes back up from a press: only the shutter button has one. */
    pressedAgainst?: Vector3
}

export interface CameraRig {
    root: Group
    pieces: RigPiece[]
    pose: CameraPose
    /** Called for every piece after the pose is applied, to add motion of its own. */
    perPiece?: (rigPiece: RigPiece, matrix: Matrix4) => void
    update(): void
}

export const LENS_AXIS = new Vector3(12.77, 40.91, 0)
export const LENS_MOUNT_Z = 14.9
export const LENS_FRONT_Z = 139.9
export const MODEL_CENTRE = new Vector3(2, 46, 44)
export const BODY_CENTRE = new Vector3(0, 46, 2)

const LENS_DETACH_MILLIMETRES = 96
const ZOOM_EXTENSION_MILLIMETRES = 24
const FRONT_BARREL_STARTS_Z = 120
const SCREEN_FLIP_HINGE = new Vector3(61.75, 0, -28.43)
const SCREEN_SWIVEL_HINGE = new Vector3(0, 30.78, -28.43)
const BODY_HALF_EXTENT = new Vector3(66, 49, 37)
const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Y = new Vector3(0, 1, 0)
const AXIS_Z = new Vector3(0, 0, 1)

const GROUP_EXPLODE_OFFSETS: Record<string, [number, number, number]> = {
    screen: [0, 0, -86],
    screen_m: [0, 0, -66],
    screen_mount: [0, 0, -46],
    screen_mount2: [0, 0, -28],
    eyepiece: [0, 14, -58],
    reg1: [0, 56, 0],
    reg6: [0, 34, 0],
    reg2: [0, 40, 0],
    reg3: [0, 40, 0],
    reg4: [0, 36, 8],
    reg5: [0, 18, 34],
    reg_iso: [0, 0, -44],
}

export function restPose(): CameraPose {
    return {
        explode: 0,
        lensDetach: 0,
        lensTwist: 0,
        zoomExtension: 0,
        focusRing: 0,
        zoomRing: 0,
        apertureRing: 0,
        glassSpread: 0,
        glassLift: 0,
        screenFlip: 0,
        screenSwivel: 0,
        modeDial: 0,
        rearDial: 0,
        exposureDial: 0,
        controlWheel: 0,
        keysPress: 0,
        keysBusy: 0,
        keysBusySeconds: 0,
        shutterPress: 0,
    }
}

export function isLensPiece(piece: ModelPiece): boolean {
    return piece.group.startsWith('lens_')
}

function dominantAxisOffset(centre: Vector3, distance: number): Vector3 {
    const relative = centre.clone().sub(BODY_CENTRE).divide(BODY_HALF_EXTENT)
    const sizes = [Math.abs(relative.x), Math.abs(relative.y), Math.abs(relative.z)]
    const axis = sizes.indexOf(Math.max(...sizes))
    const offset = new Vector3()
    offset.setComponent(axis, Math.sign(relative.getComponent(axis)) * distance * (0.6 + sizes[axis] * 0.6))
    return offset
}

function explodeOffsetOf(piece: ModelPiece): Vector3 {
    if (isLensPiece(piece)) {
        const along = 62 + (piece.centre.z - LENS_MOUNT_Z) * 0.85
        return new Vector3(0, piece.surface === 'element' ? 84 : 0, along)
    }
    if (piece.group === 'sens') return new Vector3(0, 0, 22 + (piece.centre.z - 8) * 1.6)
    const fixed = GROUP_EXPLODE_OFFSETS[piece.group]
    if (fixed) return new Vector3(...fixed)
    return dominantAxisOffset(piece.centre, piece.group === 'body' ? 30 : 44)
}

function rotationAbout(point: Vector3, axis: Vector3, angle: number, target: Matrix4): Matrix4 {
    const rotation = new Matrix4().makeRotationAxis(axis, angle)
    return target.makeTranslation(point.x, point.y, point.z).multiply(rotation).multiply(new Matrix4().makeTranslation(-point.x, -point.y, -point.z))
}

const scratch = new Matrix4()

/**
 * The shutter button. It is modelled inside the top of the body, in the collar of the power
 * switch, as a shape of its own that touches nothing. The rig cuts it out of the body and makes
 * it a part, so it can be pressed and drawn in its own way. It stands on this axis, in the
 * model's millimetres, and leans forward.
 */
const SHUTTER_BUTTON = { x: -42.5, z: 25.3, widestMillimetres: 12, travelMillimetres: 1.7 }
/** A shape is on the button's axis when its middle is this near it. */
const ON_THE_AXIS_WITHIN_MILLIMETRES = 1.5
/** The group the shutter button is given, once it is a part of its own. */
export const SHUTTER_BUTTON_GROUP = 'shutter_button'

const scratchPoint = new Vector3()

/** The points of the shutter button in a part of the body: of the shapes standing on its axis and no wider than a button, the one that reaches highest. */
function shutterButtonIn(piece: ModelPiece): { points: Set<number>; bounds: Box3 } | undefined {
    const positions = piece.solid.getAttribute('position')
    let found: { points: number[]; bounds: Box3 } | undefined
    for (const points of islandsOf(piece.solid)) {
        const bounds = new Box3()
        for (const point of points) bounds.expandByPoint(scratchPoint.fromBufferAttribute(positions, point))
        const middle = bounds.getCenter(scratchPoint)
        const onTheAxis = Math.hypot(middle.x - SHUTTER_BUTTON.x, middle.z - SHUTTER_BUTTON.z) < ON_THE_AXIS_WITHIN_MILLIMETRES
        const narrow = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) < SHUTTER_BUTTON.widestMillimetres
        if (onTheAxis && narrow && (!found || bounds.max.y > found.bounds.max.y)) found = { points, bounds }
    }
    return found && { points: new Set(found.points), bounds: found.bounds }
}

/** A drawing of the same points as `whole`, keeping only the triangles or lines (`perShape` corners each) whose first corner `keep` accepts. */
function partOf(whole: BufferGeometry, perShape: number, keep: (point: number) => boolean): BufferGeometry {
    const corners = whole.getIndex()
    const kept: number[] = []
    for (let corner = 0; corners && corner < corners.count; corner += perShape) {
        if (!keep(corners.getX(corner))) continue
        for (let offset = 0; offset < perShape; offset++) kept.push(corners.getX(corner + offset))
    }
    const part = new BufferGeometry()
    for (const [name, attribute] of Object.entries(whole.attributes)) part.setAttribute(name, attribute)
    part.setIndex(kept)
    part.boundingSphere = whole.boundingSphere
    return part
}

/** The camera's parts with the shutter button cut out of the body as a part of its own; which part it came from; and the way it faces, which is the way back up from a press. */
interface WithShutterButton {
    pieces: ModelPiece[]
    button?: { piece: ModelPiece; from: ModelPiece; facing: Vector3 }
}

/** Geometry is shared with every other rig of the model, so nothing is changed in place: the body it is cut from and the button are new drawings of the same points. */
function withShutterButton(pieces: ModelPiece[]): WithShutterButton {
    const overTheAxis = (piece: ModelPiece) =>
        piece.group === 'body' &&
        piece.bounds.min.x < SHUTTER_BUTTON.x &&
        piece.bounds.max.x > SHUTTER_BUTTON.x &&
        piece.bounds.min.z < SHUTTER_BUTTON.z &&
        piece.bounds.max.z > SHUTTER_BUTTON.z
    const found = pieces
        .filter(overTheAxis)
        .flatMap(from => {
            const button = shutterButtonIn(from)
            return button ? [{ from, ...button }] : []
        })
        .sort((first, second) => second.bounds.max.y - first.bounds.max.y)
        .at(0)
    if (!found) return { pieces }
    const { from, points, bounds } = found
    // The button faces the way its top does: the mean of its normals that point more up than sideways.
    const normals = from.solid.getAttribute('normal')
    const facing = new Vector3()
    for (const point of points) {
        if (normals.getY(point) > 0.7) facing.add(scratchPoint.fromBufferAttribute(normals, point))
    }
    if (facing.lengthSq() === 0) facing.set(0, 1, 0)
    const piece: ModelPiece = {
        ...from,
        index: pieces.length,
        name: 'shutter button',
        group: SHUTTER_BUTTON_GROUP,
        solid: partOf(from.solid, 3, point => points.has(point)),
        crease: partOf(from.crease, 2, point => points.has(point)),
        bounds,
        centre: bounds.getCenter(new Vector3()),
    }
    const rest: ModelPiece = {
        ...from,
        solid: partOf(from.solid, 3, point => !points.has(point)),
        crease: partOf(from.crease, 2, point => !points.has(point)),
    }
    return {
        pieces: [...pieces.map(each => (each === from ? rest : each)), piece],
        button: { piece, from, facing: facing.normalize() },
    }
}

/** How long one press of a key lasts, in seconds, and on what share of its beats a key is pressed at all. */
const KEY_PRESS_SECONDS = 0.24
const KEY_PRESSED_SHARE_OF_BEATS = 0.6

/** A number from 0 to 1 that is the same for the same two numbers. */
function scattered(first: number, second: number): number {
    const mixed = Math.sin(first * 127.1 + second * 311.7) * 43758.5453
    return mixed - Math.floor(mixed)
}

/** How far one key is pressed at a moment, 0..1, while the keys are pressed one at a time: each keeps a beat of its own length, starts it at its own moment, and is pressed on some of its beats and not others. */
function ownPress(key: number, seconds: number): number {
    const beatSeconds = 0.4 + scattered(key, 1) * 0.75
    const beats = seconds / beatSeconds + scattered(key, 2)
    const beat = Math.floor(beats)
    if (scattered(key, beat + 3) > KEY_PRESSED_SHARE_OF_BEATS) return 0
    const through = ((beats - beat) * beatSeconds) / KEY_PRESS_SECONDS
    return through >= 1 ? 0 : Math.sin(through * Math.PI)
}

function applyLensMotion(rigPiece: RigPiece, pose: CameraPose, matrix: Matrix4) {
    const { piece } = rigPiece
    matrix.multiply(scratch.makeTranslation(0, 0, pose.lensDetach * LENS_DETACH_MILLIMETRES))
    if (pose.lensTwist !== 0) matrix.multiply(rotationAbout(LENS_AXIS, AXIS_Z, pose.lensTwist, scratch))
    if (piece.bounds.min.z > FRONT_BARREL_STARTS_Z) matrix.multiply(scratch.makeTranslation(0, 0, pose.zoomExtension * ZOOM_EXTENSION_MILLIMETRES))
    if (piece.group === 'lens_ring1') matrix.multiply(rotationAbout(LENS_AXIS, AXIS_Z, pose.focusRing, scratch))
    if (piece.group === 'lens_ring2') matrix.multiply(rotationAbout(LENS_AXIS, AXIS_Z, pose.zoomRing, scratch))
    if (piece.group === 'lens_ring3') matrix.multiply(rotationAbout(LENS_AXIS, AXIS_Z, pose.apertureRing, scratch))
    if (piece.surface !== 'element') return
    const spread = (rigPiece.lensFraction - 0.5) * 150 * pose.glassSpread
    matrix.multiply(scratch.makeTranslation(0, pose.glassLift, spread))
}

function applyBodyMotion(rigPiece: RigPiece, pose: CameraPose, matrix: Matrix4) {
    const { piece } = rigPiece
    if (piece.group === 'screen' || piece.group === 'screen_m') {
        matrix.multiply(rotationAbout(SCREEN_FLIP_HINGE, AXIS_Y, pose.screenFlip, scratch))
    }
    if (piece.group === 'screen') matrix.multiply(rotationAbout(SCREEN_SWIVEL_HINGE, AXIS_X, pose.screenSwivel, scratch))
    if (piece.group === 'reg1') matrix.multiply(rotationAbout(piece.centre, AXIS_Y, pose.modeDial, scratch))
    if (piece.group === 'reg2') matrix.multiply(rotationAbout(piece.centre, AXIS_Y, pose.rearDial, scratch))
    if (piece.group === 'reg3') matrix.multiply(rotationAbout(piece.centre, AXIS_Y, pose.exposureDial, scratch))
    if (piece.group === 'reg_iso') matrix.multiply(rotationAbout(piece.centre, AXIS_Z, pose.controlWheel, scratch))
    if (rigPiece.pressedAgainst && pose.shutterPress !== 0) {
        const travel = -SHUTTER_BUTTON.travelMillimetres * pose.shutterPress
        matrix.multiply(scratch.makeTranslation(rigPiece.pressedAgainst.x * travel, rigPiece.pressedAgainst.y * travel, rigPiece.pressedAgainst.z * travel))
    }
    if (piece.group !== 'keys') return
    const pressed = Math.max(pose.keysPress, pose.keysBusy > 0 ? pose.keysBusy * ownPress(piece.index, pose.keysBusySeconds) : 0)
    if (pressed === 0) return
    const press = dominantAxisOffset(piece.centre, -0.9 * pressed)
    matrix.multiply(scratch.makeTranslation(press.x, press.y, press.z))
}

/** One camera, drawn with the layers `layersOf` gives each piece. Geometry is shared between rigs. */
export function createCameraRig(model: Model, layersOf: (piece: ModelPiece) => Object3D[]): CameraRig {
    const root = new Group()
    const { pieces: parts, button } = withShutterButton(model.pieces)
    const pieces: RigPiece[] = parts.map(piece => {
        const group = new Group()
        group.matrixAutoUpdate = false
        group.add(...layersOf(piece))
        root.add(group)
        const lensFraction = isLensPiece(piece) ? (piece.centre.z - LENS_MOUNT_Z) / (LENS_FRONT_Z - LENS_MOUNT_Z) : -1
        // The button goes wherever the part it was cut from goes when the camera is drawn apart.
        const isTheButton = piece === button?.piece
        const explodeOffset = explodeOffsetOf(isTheButton ? button.from : piece)
        return { piece, group, explodeOffset, lensFraction, pressedAgainst: isTheButton ? button.facing : undefined }
    })

    const rig: CameraRig = {
        root,
        pieces,
        pose: restPose(),
        update() {
            const { pose } = rig
            for (const rigPiece of pieces) {
                const matrix = rigPiece.group.matrix.identity()
                const offset = rigPiece.explodeOffset
                if (pose.explode !== 0) matrix.makeTranslation(offset.x * pose.explode, offset.y * pose.explode, offset.z * pose.explode)
                if (isLensPiece(rigPiece.piece)) applyLensMotion(rigPiece, pose, matrix)
                else applyBodyMotion(rigPiece, pose, matrix)
                rig.perPiece?.(rigPiece, matrix)
                rigPiece.group.matrixWorldNeedsUpdate = true
            }
        },
    }
    rig.update()
    return rig
}
