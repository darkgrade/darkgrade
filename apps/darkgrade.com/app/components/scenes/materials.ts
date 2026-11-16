import { BackSide, Color, DoubleSide, LineBasicMaterial, ShaderMaterial, Vector2, Vector3 } from 'three'

/** The pixel size of the canvas being drawn. Whoever draws sets it first: outlines are a fixed number of pixels wide. */
export const viewportSize = { value: new Vector2(800, 600) }

const TONE_VERTEX = /* glsl */ `
    varying vec3 vViewNormal;
    void main() {
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`

const TONE_FRAGMENT = /* glsl */ `
    varying vec3 vViewNormal;
    uniform vec3 uShadow;
    uniform vec3 uLight;
    uniform vec3 uLightDirection;
    uniform float uSteps;
    void main() {
        vec3 normal = normalize(vViewNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        float tone = dot(normal, normalize(uLightDirection)) * 0.5 + 0.5;
        tone = clamp(floor(tone * uSteps + 0.5) / uSteps, 0.0, 1.0);
        gl_FragColor = vec4(mix(uShadow, uLight, tone), 1.0);
        #include <colorspace_fragment>
    }
`

/** A flat fill in a few steps between two colours, lit from one fixed direction. */
export function toneMaterial(shadow: string, light: string, steps: number): ShaderMaterial {
    return new ShaderMaterial({
        vertexShader: TONE_VERTEX,
        fragmentShader: TONE_FRAGMENT,
        uniforms: {
            uShadow: { value: new Color(shadow) },
            uLight: { value: new Color(light) },
            uLightDirection: { value: new Vector3(-0.45, 0.75, 0.6) },
            uSteps: { value: steps },
        },
        // Both sides, so the inside of an open shell shows its fill and not the outline hull behind it.
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1.5,
        polygonOffsetUnits: 2,
    })
}

/** The inverted hull: back faces pushed out a fixed number of pixels, drawn in the line colour. */
export function outlineMaterial(colour: string, widthPixels: number): ShaderMaterial {
    return new ShaderMaterial({
        uniforms: { uColour: { value: new Color(colour) }, uWidth: { value: widthPixels }, uViewport: viewportSize },
        vertexShader: /* glsl */ `
            uniform float uWidth;
            uniform vec2 uViewport;
            void main() {
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                vec3 viewNormal = normalize(normalMatrix * normal);
                vec2 direction = normalize(viewNormal.xy + vec2(0.00001));
                gl_Position.xy += direction * uWidth * 2.0 * gl_Position.w / uViewport;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform vec3 uColour;
            void main() {
                gl_FragColor = vec4(uColour, 1.0);
                #include <colorspace_fragment>
            }
        `,
        side: BackSide,
        // Further back than the fill, so inside an open shell the fill covers the hull.
        polygonOffset: true,
        polygonOffsetFactor: 4,
        polygonOffsetUnits: 16,
    })
}

export function lineMaterial(colour: string, opacity = 1): LineBasicMaterial {
    return new LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity })
}
