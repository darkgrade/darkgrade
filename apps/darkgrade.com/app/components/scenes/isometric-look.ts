import { BufferGeometry, Color, Float32BufferAttribute, LineSegments, Mesh, type Object3D, Points, ShaderMaterial } from 'three'

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

/** Where the dots start to dissolve, as a share of the floor's radius: almost from the middle, so the floor is a soft round pool. */
const DOTS_FADE_FROM = 0.08
const DOT_SIZE_PIXELS = 3

/** A round floor of dots, `halfCount` dots from the middle to its rim, fading all the way out from the middle. */
export function dotGrid(groundY: number, spacingMillimetres: number, halfCount: number): Points {
    const positions: number[] = []
    for (let column = -halfCount; column <= halfCount; column++) {
        for (let row = -halfCount; row <= halfCount; row++) {
            if (Math.hypot(column, row) <= halfCount) positions.push(column * spacingMillimetres, groundY, row * spacingMillimetres)
        }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    const material = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
            uColour: { value: new Color(ANATOMY.dot) },
            uReach: { value: halfCount * spacingMillimetres },
            uFadeFrom: { value: DOTS_FADE_FROM },
            uSize: { value: DOT_SIZE_PIXELS },
        },
        vertexShader: /* glsl */ `
            uniform float uReach;
            uniform float uFadeFrom;
            uniform float uSize;
            varying float vStrength;
            void main() {
                vStrength = 1.0 - smoothstep(uFadeFrom, 1.0, length(position.xz) / uReach);
                gl_PointSize = uSize;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */ `
            uniform vec3 uColour;
            varying float vStrength;
            void main() {
                gl_FragColor = vec4(uColour, vStrength);
                #include <colorspace_fragment>
            }
        `,
    })
    return new Points(geometry, material)
}
