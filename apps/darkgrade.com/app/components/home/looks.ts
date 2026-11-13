import {
    BackSide,
    Color,
    DoubleSide,
    LineBasicMaterial,
    LineSegments,
    type Material,
    Mesh,
    type Object3D,
    type Plane,
    ShaderMaterial,
    type Side,
    Vector3,
} from 'three'

import type { ModelPiece } from '@/app/components/scenes/load-model'
import { viewportSize } from '@/app/components/scenes/materials'

/** The site's colours, for scenes that draw on its near-black page. */
export const PALETTE = {
    background: '#0a0a0b',
    panel: '#111113',
    cream: '#eae6dc',
    gold: '#f6dda8',
    amber: '#f4c66e',
    red: '#e0483e',
    graphite: '#1b1b1e',
    steel: '#3a3a40',
} as const

const SURFACE_VERTEX = /* glsl */ `
    #include <common>
    #include <clipping_planes_pars_vertex>
    varying vec3 vViewNormal;
    varying vec3 vWorldPosition;
    varying vec3 vViewPosition;
    void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewNormal = normalize(normalMatrix * normal);
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
    }
`

const SURFACE_FRAGMENT_HEAD = /* glsl */ `
    #include <common>
    #include <clipping_planes_pars_fragment>
    varying vec3 vViewNormal;
    varying vec3 vWorldPosition;
    varying vec3 vViewPosition;
    uniform vec3 uShadow;
    uniform vec3 uLight;
    uniform vec3 uRim;
    uniform vec3 uLightDirection;
    uniform float uRimPower;
    uniform float uRimStrength;
    uniform float uSteps;
    uniform float uOpacity;
    uniform float uTime;
    float toneOf(vec3 normal) {
        float tone = dot(normal, normalize(uLightDirection)) * 0.5 + 0.5;
        if (uSteps > 0.0) tone = floor(tone * uSteps + 0.5) / uSteps;
        return clamp(tone, 0.0, 1.0);
    }
    float fresnelOf(vec3 normal) {
        return pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), uRimPower);
    }
`

const TONE_FRAGMENT = /* glsl */ `
    ${SURFACE_FRAGMENT_HEAD}
    void main() {
        #include <clipping_planes_fragment>
        vec3 normal = normalize(vViewNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 colour = mix(uShadow, uLight, toneOf(normal)) + uRim * fresnelOf(normal) * uRimStrength;
        gl_FragColor = vec4(colour, uOpacity);
        #include <colorspace_fragment>
    }
`

interface ToneOptions {
    shadow: string
    light: string
    /** The colour edges catch where the surface turns away from the viewer. */
    rim?: string
    rimPower?: number
    rimStrength?: number
    /** How many flat steps of shade; smooth when 0 or left out. */
    steps?: number
    opacity?: number
    side?: Side
    clippingPlanes?: Plane[]
    /** Draw a little behind the lines laid over it; on unless given. */
    offset?: boolean
}

function surfaceUniforms(options: ToneOptions) {
    return {
        uShadow: { value: new Color(options.shadow) },
        uLight: { value: new Color(options.light) },
        uRim: { value: new Color(options.rim ?? options.light) },
        uLightDirection: { value: new Vector3(-0.45, 0.75, 0.6) },
        uRimPower: { value: options.rimPower ?? 3 },
        uRimStrength: { value: options.rimStrength ?? 0 },
        uSteps: { value: options.steps ?? 0 },
        uOpacity: { value: options.opacity ?? 1 },
        uTime: { value: 0 },
    }
}

function surfaceMaterial(
    fragmentShader: string,
    options: ToneOptions,
    uniforms: Record<string, { value: unknown }>
): ShaderMaterial {
    return new ShaderMaterial({
        vertexShader: SURFACE_VERTEX,
        fragmentShader,
        uniforms: { ...surfaceUniforms(options), ...uniforms },
        clipping: true,
        clippingPlanes: options.clippingPlanes ?? [],
        // Both sides, so the inside of an open shell shows its fill and not the outline hull behind it.
        side: options.side ?? DoubleSide,
        transparent: (options.opacity ?? 1) < 1,
        polygonOffset: options.offset ?? true,
        polygonOffsetFactor: 1.5,
        polygonOffsetUnits: 2,
    })
}

/**
 * A fill between two colours, lit from one fixed direction, with an optional rim. Its uniforms
 * (uShadow, uLight, uRim, uRimStrength, uOpacity, uLightDirection, uTime) may be changed per frame.
 */
function shadeMaterial(options: ToneOptions): ShaderMaterial {
    return surfaceMaterial(TONE_FRAGMENT, options, {})
}

/** The inverted hull: back faces pushed out a fixed number of pixels, drawn in the line colour. */
function hullMaterial(colour: string, widthPixels: number, clippingPlanes: Plane[] = []): ShaderMaterial {
    return new ShaderMaterial({
        uniforms: {
            uColour: { value: new Color(colour) },
            uWidth: { value: widthPixels },
            uViewport: viewportSize,
            uOpacity: { value: 1 },
        },
        vertexShader: /* glsl */ `
            #include <common>
            #include <clipping_planes_pars_vertex>
            uniform float uWidth;
            uniform vec2 uViewport;
            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                vec3 viewNormal = normalize(normalMatrix * normal);
                vec2 direction = normalize(viewNormal.xy + vec2(0.00001));
                gl_Position.xy += direction * uWidth * 2.0 * gl_Position.w / uViewport;
                #include <clipping_planes_vertex>
            }
        `,
        fragmentShader: /* glsl */ `
            #include <common>
            #include <clipping_planes_pars_fragment>
            uniform vec3 uColour;
            uniform float uOpacity;
            void main() {
                #include <clipping_planes_fragment>
                gl_FragColor = vec4(uColour, uOpacity);
                #include <colorspace_fragment>
            }
        `,
        side: BackSide,
        clipping: true,
        clippingPlanes,
        // Further back than the fill, so inside an open shell the fill covers the hull.
        polygonOffset: true,
        polygonOffsetFactor: 4,
        polygonOffsetUnits: 16,
    })
}

function strokeMaterial(colour: string, opacity = 1, clippingPlanes: Plane[] = []): LineBasicMaterial {
    return new LineBasicMaterial({ color: colour, transparent: true, opacity, clippingPlanes })
}

function solid(piece: ModelPiece, material: Material, renderOrder = 0): Mesh {
    const mesh = new Mesh(piece.solid, material)
    mesh.renderOrder = renderOrder
    return mesh
}

function crease(piece: ModelPiece, material: Material): LineSegments {
    return new LineSegments(piece.crease, material)
}

/** How a look draws one part. */
export type Look = (piece: ModelPiece) => Object3D[]

function isGlass(piece: ModelPiece): boolean {
    return piece.surface === 'element' || piece.surface === 'glass'
}

export interface InkOptions {
    fillShadow?: string
    fillLight?: string
    line?: string
    lineOpacity?: number
    outline?: string
    outlineWidth?: number
    accent?: string
    rim?: string
    rimStrength?: number
    clippingPlanes?: Plane[]
}

/** The materials of the ink look, kept so a scene can change their uniforms as it runs. */
export interface InkMaterials {
    fill: ShaderMaterial
    glassFill: ShaderMaterial
    ink: LineBasicMaterial
    accentInk: LineBasicMaterial
    hull: ShaderMaterial
    look: Look
}

/** The house look: dark tonal fill, cream crease lines, a heavier outline, glass picked out in gold. */
export function inkMaterials(options: InkOptions = {}): InkMaterials {
    const clippingPlanes = options.clippingPlanes ?? []
    const accent = options.accent ?? PALETTE.gold
    const fill = shadeMaterial({
        shadow: options.fillShadow ?? '#0b0b0d',
        light: options.fillLight ?? '#26262a',
        rim: options.rim ?? PALETTE.cream,
        rimStrength: options.rimStrength ?? 0,
        clippingPlanes,
    })
    const glassFill = shadeMaterial({
        shadow: '#0b0b0d',
        light: '#1a1814',
        rim: accent,
        rimStrength: 0.55,
        rimPower: 2.2,
        clippingPlanes,
    })
    const ink = strokeMaterial(options.line ?? PALETTE.cream, options.lineOpacity ?? 0.62, clippingPlanes)
    const accentInk = strokeMaterial(accent, 0.9, clippingPlanes)
    const hull = hullMaterial(options.outline ?? PALETTE.cream, options.outlineWidth ?? 1.1, clippingPlanes)
    return {
        fill,
        glassFill,
        ink,
        accentInk,
        hull,
        look: piece => [
            solid(piece, isGlass(piece) ? glassFill : fill),
            solid(piece, hull),
            crease(piece, isGlass(piece) ? accentInk : ink),
        ],
    }
}
