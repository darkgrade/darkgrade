import { Box3, Group, Matrix4, type Object3D, Vector3 } from 'three'

import type { ModelJoint, ModelPiece } from '@/app/components/scenes/load-model'

/** Two ways of drawing a part: as it is, or picked out. */
export interface RigLayers {
    plain(piece: ModelPiece): Object3D[]
    gold(piece: ModelPiece): Object3D[]
}

/**
 * One copy of a studio item that can be posed. `pose` holds a number for each joint by name
 * (radians for a turn, millimetres for a slide) and `explode`, from 0 to 1, which draws its bodies
 * apart. `lit` says whether its light is on, and `highlighted` draws the whole item in gold.
 */
export interface ItemRig {
    /** Place the item by moving and turning this. */
    root: Group
    pose: Record<string, number>
    lit: boolean
    highlighted: boolean
    /** The item's size, in millimetres. */
    size: Vector3
    update(): void
}

interface Body {
    group: Group
    /** The joints that move it, the outermost first. */
    chain: ModelJoint[]
    explodeOffset: Vector3
    plain: Object3D[]
    gold: Object3D[]
    /** Whether these are the faces a light shines from. */
    shines: boolean[]
}

const LIT_SUFFIX = ' (lit)'
const EXPLODE_REACH = 0.9
const EXPLODE_RISE_MILLIMETRES = 60

function depthOf(joint: ModelJoint, joints: ModelJoint[]): number {
    const parent = joint.parent ? joints.find(candidate => candidate.name === joint.parent) : undefined
    return parent ? depthOf(parent, joints) + 1 : 0
}

const turn = new Matrix4()
const step = new Matrix4()
const axis = new Vector3()

function applyJoint(matrix: Matrix4, joint: ModelJoint, value: number) {
    if (value === 0) return
    axis.fromArray(joint.axis)
    if (joint.kind === 'slide') {
        matrix.multiply(step.makeTranslation(axis.x * value, axis.y * value, axis.z * value))
        return
    }
    const [x, y, z] = joint.origin
    matrix.multiply(step.makeTranslation(x, y, z)).multiply(turn.makeRotationAxis(axis, value)).multiply(step.makeTranslation(-x, -y, -z))
}

export function createItemRig(pieces: ModelPiece[], joints: ModelJoint[], layers: RigLayers): ItemRig {
    const root = new Group()
    const bounds = new Box3()
    for (const piece of pieces) bounds.union(piece.bounds)
    const middle = bounds.getCenter(new Vector3())
    const bodies = new Map<string, Body>()

    for (const piece of pieces) {
        const name = piece.name.endsWith(LIT_SUFFIX) ? piece.name.slice(0, -LIT_SUFFIX.length) : piece.name
        let body = bodies.get(name)
        if (!body) {
            const group = new Group()
            group.matrixAutoUpdate = false
            root.add(group)
            const chain = joints.filter(joint => joint.bodies.includes(name)).sort((first, second) => depthOf(first, joints) - depthOf(second, joints))
            body = { group, chain, explodeOffset: new Vector3(), plain: [], gold: [], shines: [] }
            bodies.set(name, body)
        }
        const plain = layers.plain(piece)
        const gold = layers.gold(piece)
        body.group.add(...plain, ...gold)
        for (const layer of plain) {
            body.plain.push(layer)
            body.shines.push(piece.surface === 'element')
        }
        body.gold.push(...gold)
    }

    for (const [name, body] of bodies) {
        const box = new Box3()
        for (const piece of pieces) if (piece.name === name) box.union(piece.bounds)
        body.explodeOffset.copy(box.getCenter(new Vector3())).sub(middle).multiplyScalar(EXPLODE_REACH)
        body.explodeOffset.y += EXPLODE_RISE_MILLIMETRES
    }

    const rig: ItemRig = {
        root,
        pose: { explode: 0 },
        lit: true,
        highlighted: false,
        size: bounds.getSize(new Vector3()),
        update() {
            const explode = rig.pose.explode ?? 0
            for (const body of bodies.values()) {
                const matrix = body.group.matrix.identity()
                if (explode !== 0) matrix.makeTranslation(body.explodeOffset.x * explode, body.explodeOffset.y * explode, body.explodeOffset.z * explode)
                for (const joint of body.chain) applyJoint(matrix, joint, rig.pose[joint.name] ?? 0)
                body.group.matrixWorldNeedsUpdate = true
                // Three layers a piece, in the same order plain and gold: show one of each pair.
                body.plain.forEach((layer, index) => {
                    const gold = rig.highlighted || (rig.lit && body.shines[index])
                    layer.visible = !gold
                    body.gold[index].visible = gold
                })
            }
        },
    }
    rig.update()
    return rig
}
