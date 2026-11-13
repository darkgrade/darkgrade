import { Group, Matrix4, type Object3D, Vector3 } from 'three'

import type { Model, ModelPiece } from '@/app/components/scenes/load-model'

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
    keysPress: number
}

export interface RigPiece {
    piece: ModelPiece
    group: Group
    explodeOffset: Vector3
    /** Where this piece sits along the lens axis, 0 at the mount and 1 at the front; -1 off the lens. */
    lensFraction: number
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
    if (piece.group !== 'keys' || pose.keysPress === 0) return
    const press = dominantAxisOffset(piece.centre, -0.9 * pose.keysPress)
    matrix.multiply(scratch.makeTranslation(press.x, press.y, press.z))
}

/** One camera, drawn with the layers `layersOf` gives each piece. Geometry is shared between rigs. */
export function createCameraRig(model: Model, layersOf: (piece: ModelPiece) => Object3D[]): CameraRig {
    const root = new Group()
    const pieces: RigPiece[] = model.pieces.map(piece => {
        const group = new Group()
        group.matrixAutoUpdate = false
        group.add(...layersOf(piece))
        root.add(group)
        const lensFraction = isLensPiece(piece) ? (piece.centre.z - LENS_MOUNT_Z) / (LENS_FRONT_Z - LENS_MOUNT_Z) : -1
        return { piece, group, explodeOffset: explodeOffsetOf(piece), lensFraction }
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
