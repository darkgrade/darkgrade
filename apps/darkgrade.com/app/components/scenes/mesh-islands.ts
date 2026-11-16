import type { BufferGeometry } from 'three'

/** Points closer together than this, in the geometry's own units, are taken to be one point. */
const SAME_POINT_WITHIN = 0.02

/** The name two points share when they are in the same place: a mesh often repeats a point, once for each face that meets there. */
function placeKey(x: number, y: number, z: number): string {
    return `${Math.round(x / SAME_POINT_WITHIN)},${Math.round(y / SAME_POINT_WITHIN)},${Math.round(z / SAME_POINT_WITHIN)}`
}

/**
 * The separate shapes a mesh is made of: each is the points joined to one another through its
 * triangles, given by their indices. A button modelled inside a body, touching nothing, is one.
 */
export function islandsOf(geometry: BufferGeometry): number[][] {
    const positions = geometry.getAttribute('position')
    const corners = geometry.getIndex()
    if (!corners) return []
    const placeOf: number[] = []
    const places = new Map<string, number>()
    for (let point = 0; point < positions.count; point++) {
        const key = placeKey(positions.getX(point), positions.getY(point), positions.getZ(point))
        if (!places.has(key)) places.set(key, places.size)
        placeOf.push(places.get(key) ?? 0)
    }
    // Each place points at another place of its island; the one that points at itself names the island.
    const joinedTo = Array.from({ length: places.size }, (_, place) => place)
    function islandOf(place: number): number {
        while (joinedTo[place] !== place) {
            joinedTo[place] = joinedTo[joinedTo[place]]
            place = joinedTo[place]
        }
        return place
    }
    for (let corner = 0; corner < corners.count; corner += 3) {
        const first = islandOf(placeOf[corners.getX(corner)])
        joinedTo[islandOf(placeOf[corners.getX(corner + 1)])] = first
        joinedTo[islandOf(placeOf[corners.getX(corner + 2)])] = first
    }
    const islands = new Map<number, number[]>()
    for (let point = 0; point < positions.count; point++) {
        const island = islandOf(placeOf[point])
        const points = islands.get(island)
        if (points) points.push(point)
        else islands.set(island, [point])
    }
    return [...islands.values()]
}
