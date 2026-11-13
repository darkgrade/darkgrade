import { BufferGeometry, Float32BufferAttribute, LineSegments, Mesh, type Object3D, PlaneGeometry, Points, PointsMaterial, ShaderMaterial } from 'three'

import type { ModelPiece } from '@/app/components/scenes/load-model'
import { lineMaterial, outlineMaterial, toneMaterial } from '@/app/components/scenes/materials'

/** The palette of the site's isometric drawings. */
export const ANATOMY = {
    shadeDark: '#100e0b',
    shadeLight: '#221e18',
    edge: '#e6dfcf',
    crease: '#857c6f',
    lit: '#f6dda8',
    litShade: '#2b261d',
    litTop: '#3b3427',
    dot: '#4a443b',
} as const

export const ISOMETRIC_ELEVATION_DEGREES = 35.264
export const ISOMETRIC_FIELD_OF_VIEW_DEGREES = 4

/** The two ways the drawings render a part: plain, in flat warm shades with a cream outline, or picked out in gold. */
export interface IsometricLayers {
    plain(piece: ModelPiece): Object3D[]
    gold(piece: ModelPiece): Object3D[]
}

export function isometricLayers(): IsometricLayers {
    const shade = toneMaterial(ANATOMY.shadeDark, ANATOMY.shadeLight, 4)
    const litShade = toneMaterial(ANATOMY.litShade, ANATOMY.litTop, 3)
    const edge = outlineMaterial(ANATOMY.edge, 1)
    const creases = lineMaterial(ANATOMY.crease, 0.85)
    const litEdge = outlineMaterial(ANATOMY.lit, 1)
    const litCreases = lineMaterial(ANATOMY.lit, 0.9)
    return {
        plain: piece => [new Mesh(piece.solid, shade), new Mesh(piece.solid, edge), new LineSegments(piece.crease, creases)],
        gold: piece => [new Mesh(piece.solid, litShade), new Mesh(piece.solid, litEdge), new LineSegments(piece.crease, litCreases)],
    }
}

/** A square grid of dots on the floor, `halfCount` dots each way from the middle. */
export function dotGrid(groundY: number, spacingMillimetres: number, halfCount: number): Points {
    const positions: number[] = []
    for (let column = -halfCount; column <= halfCount; column++) {
        for (let row = -halfCount; row <= halfCount; row++) positions.push(column * spacingMillimetres, groundY, row * spacingMillimetres)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return new Points(geometry, new PointsMaterial({ color: ANATOMY.dot, size: 3, sizeAttenuation: false }))
}

/** The soft dark pool a drawing sits in. */
export function halo(groundY: number, sizeMillimetres: number): Mesh {
    const material = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */ `
            varying vec2 vUv;
            void main() {
                float falloff = 1.0 - smoothstep(0.25, 1.0, length((vUv - 0.5) * 2.0));
                gl_FragColor = vec4(0.012, 0.012, 0.012, falloff * 0.7);
            }
        `,
    })
    const pool = new Mesh(new PlaneGeometry(sizeMillimetres, sizeMillimetres), material)
    pool.rotation.x = -Math.PI / 2
    pool.position.y = groundY + 0.5
    return pool
}
