import { Box3, BufferAttribute, BufferGeometry, Vector3 } from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

import { deriveLines } from '@/app/components/scenes/derive-lines'

/** What a part is made of, as far as the drawing cares: glass and lit faces are picked out in gold. */
export type SurfaceKind = 'body' | 'lensBarrel' | 'glass' | 'element'

/** A part of a model that can move on its own, as a fill and as its crease lines. */
export interface ModelPiece {
    index: number
    name: string
    /** The item the part belongs to: a group of the camera's parts, or one item of the studio kit. */
    group: string
    surface: SurfaceKind
    solid: BufferGeometry
    crease: BufferGeometry
    bounds: Box3
    centre: Vector3
}

/** How some of a model's parts move against the rest. */
export interface ModelJoint {
    item: string
    /** What a pose calls it. Joints of one item that share a name move together. */
    name: string
    kind: 'turn' | 'slide'
    /** A point on the line it turns about, in millimetres. */
    origin: [number, number, number]
    /** The direction it turns about, or slides along. */
    axis: [number, number, number]
    /** The names of the parts it moves. */
    bodies: string[]
    /** The joint that carries this one, if any. */
    parent?: string
}

export interface Model {
    pieces: ModelPiece[]
    /** Empty for a model with no rig of its own in the file. */
    joints: ModelJoint[]
}

/** The camera, or one each of the nine items of a photo studio. Both are in millimetres. */
export type ModelName = 'camera' | 'studio'

/**
 * The description at the head of a model file. A file is
 * gzip([uint32 length of the description][description as JSON][one Draco mesh a part]).
 */
interface Description {
    joints?: ModelJoint[]
    parts: { name: string; group: string; material: string; byteStart: number; byteLength: number }[]
}

const MODEL_FOLDER = '/models'
const CREASE_DEGREES = 32

const SURFACE_OF_MATERIAL: Record<string, SurfaceKind> = {
    sony_a7rv_kit: 'body',
    sony_a7rv_lens: 'lensBarrel',
    glass: 'glass',
    Lens_1: 'element',
    Lens_2: 'element',
    // The faces a studio light shines from.
    emission: 'element',
}

async function gunzip(compressed: ArrayBuffer): Promise<ArrayBuffer> {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Response(stream).arrayBuffer()
}

let dracoLoader: DRACOLoader | undefined

function decodeDraco(mesh: ArrayBuffer): Promise<BufferGeometry> {
    const loader = (dracoLoader ??= new DRACOLoader().setDecoderPath(`${MODEL_FOLDER}/draco/`))
    return new Promise((resolve, reject) => loader.parse(mesh, resolve, reject))
}

async function readPiece(part: Description['parts'][number], meshes: Uint8Array, index: number): Promise<ModelPiece> {
    const decoded = await decodeDraco(meshes.slice(part.byteStart, part.byteStart + part.byteLength).buffer)
    const positions = decoded.getAttribute('position').array as Float32Array
    const normals = Int8Array.from(decoded.getAttribute('normal').array, value => Math.round(value * 127))
    const decodedTriangles = decoded.getIndex()
    if (!decodedTriangles) throw new Error(`${part.name} has no triangles`)
    const triangles = Uint32Array.from(decodedTriangles.array)

    const solid = new BufferGeometry()
    solid.setAttribute('position', new BufferAttribute(positions, 3))
    solid.setAttribute('normal', new BufferAttribute(normals, 3, true))
    solid.setIndex(new BufferAttribute(triangles, 1))
    solid.computeBoundingSphere()

    const crease = new BufferGeometry()
    crease.setAttribute('position', solid.getAttribute('position'))
    crease.setIndex(new BufferAttribute(deriveLines(positions, triangles, CREASE_DEGREES).crease, 1))
    crease.boundingSphere = solid.boundingSphere

    const bounds = new Box3().setFromBufferAttribute(solid.getAttribute('position') as BufferAttribute)
    return { index, name: part.name, group: part.group, surface: SURFACE_OF_MATERIAL[part.material] ?? 'body', solid, crease, bounds, centre: bounds.getCenter(new Vector3()) }
}

async function load(name: ModelName): Promise<Model> {
    const response = await fetch(`${MODEL_FOLDER}/${name}.bin`)
    if (!response.ok) throw new Error(`${name}.bin: ${response.status}`)
    const container = new Uint8Array(await gunzip(await response.arrayBuffer()))
    const descriptionBytes = new DataView(container.buffer).getUint32(0, true)
    const description = JSON.parse(new TextDecoder().decode(container.subarray(4, 4 + descriptionBytes))) as Description
    const meshes = container.subarray(4 + descriptionBytes)
    const pieces = await Promise.all(description.parts.map((part, index) => readPiece(part, meshes, index)))
    return { pieces, joints: description.joints ?? [] }
}

const pending = new Map<ModelName, Promise<Model>>()

/** Fetches a model once, however many scenes ask for it. */
export function loadModel(name: ModelName): Promise<Model> {
    let model = pending.get(name)
    if (!model) {
        model = load(name)
        pending.set(name, model)
    }
    return model
}
