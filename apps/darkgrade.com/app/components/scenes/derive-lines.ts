/**
 * Finds the edges worth drawing on a triangle mesh that has no line data of its own.
 *
 * An edge is a crease when it borders one triangle, or when the two triangles on it meet at more
 * than `creaseDegrees`. It is a wire edge at more than WIRE_DEGREES, which hides the triangulation
 * inside flat faces and keeps the lines that follow the shape. Vertices that share a position
 * are treated as one, so seams in normals or texture coordinates do not count as borders.
 */
const WIRE_DEGREES = 5
const WIRE_COSINE = Math.cos((WIRE_DEGREES * Math.PI) / 180)
const WELD_STEPS_PER_MILLIMETRE = 50

interface Edge {
    first: number
    second: number
    normalX: number
    normalY: number
    normalZ: number
    faces: number
    cosine: number
}

function weldByPosition(positions: Float32Array): Uint32Array {
    const welded = new Uint32Array(positions.length / 3)
    const seen = new Map<string, number>()
    for (let vertex = 0; vertex < welded.length; vertex++) {
        const key =
            `${Math.round(positions[vertex * 3] * WELD_STEPS_PER_MILLIMETRE)},` +
            `${Math.round(positions[vertex * 3 + 1] * WELD_STEPS_PER_MILLIMETRE)},` +
            `${Math.round(positions[vertex * 3 + 2] * WELD_STEPS_PER_MILLIMETRE)}`
        const existing = seen.get(key)
        welded[vertex] = existing ?? vertex
        if (existing === undefined) seen.set(key, vertex)
    }
    return welded
}

export function deriveLines<IndexArray extends Uint16Array | Uint32Array>(
    positions: Float32Array,
    triangles: IndexArray,
    creaseDegrees: number,
): { wire: IndexArray; crease: IndexArray } {
    const creaseCosine = Math.cos((creaseDegrees * Math.PI) / 180)
    const welded = weldByPosition(positions)
    const vertexCount = welded.length
    const edges = new Map<number, Edge>()

    for (let offset = 0; offset < triangles.length; offset += 3) {
        const corners = [triangles[offset], triangles[offset + 1], triangles[offset + 2]]
        const [a, b, c] = corners.map(corner => corner * 3) as [number, number, number]
        const abX = positions[b] - positions[a]
        const abY = positions[b + 1] - positions[a + 1]
        const abZ = positions[b + 2] - positions[a + 2]
        const acX = positions[c] - positions[a]
        const acY = positions[c + 1] - positions[a + 1]
        const acZ = positions[c + 2] - positions[a + 2]
        let normalX = abY * acZ - abZ * acY
        let normalY = abZ * acX - abX * acZ
        let normalZ = abX * acY - abY * acX
        const length = Math.hypot(normalX, normalY, normalZ)
        if (length === 0) continue
        normalX /= length
        normalY /= length
        normalZ /= length

        for (let side = 0; side < 3; side++) {
            const first = corners[side]
            const second = corners[(side + 1) % 3]
            const low = Math.min(welded[first], welded[second])
            const high = Math.max(welded[first], welded[second])
            if (low === high) continue
            const key = low * vertexCount + high
            const edge = edges.get(key)
            if (!edge) {
                edges.set(key, { first, second, normalX, normalY, normalZ, faces: 1, cosine: 1 })
                continue
            }
            edge.faces++
            edge.cosine = Math.min(edge.cosine, edge.normalX * normalX + edge.normalY * normalY + edge.normalZ * normalZ)
        }
    }

    const wire: number[] = []
    const crease: number[] = []
    for (const edge of edges.values()) {
        const border = edge.faces !== 2
        if (border || edge.cosine < WIRE_COSINE) wire.push(edge.first, edge.second)
        if (border || edge.cosine < creaseCosine) crease.push(edge.first, edge.second)
    }
    const IndexArray = triangles.constructor as new (values: number[]) => IndexArray
    return { wire: new IndexArray(wire), crease: new IndexArray(crease) }
}
