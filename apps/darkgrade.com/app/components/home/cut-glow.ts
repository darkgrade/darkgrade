import {
    AdditiveBlending,
    Color,
    FramebufferTexture,
    HalfFloatType,
    LinearFilter,
    Mesh,
    NoBlending,
    OrthographicCamera,
    PlaneGeometry,
    Scene,
    ShaderMaterial,
    type Texture,
    Vector2,
    WebGLRenderTarget,
    type WebGLRenderer,
} from 'three'

import type { Frame } from '@/app/components/home/viewport'

/** The light that spills from what is gold in the picture, as it was tuned by eye. */
const LIGHT = {
    /** How bright a part of the picture must be before it throws light, and how gradually it starts to. */
    threshold: 0.48,
    knee: 0.4,
    /** The tight glow round a light, the wide halo film puts beyond it, and the streak a lens draws across it. */
    glow: 0.39,
    halo: 0.58,
    haloColour: '#ff5a26',
    streak: 0.115,
    streakColour: '#ffd9a8',
    /** How strong all of it is while nothing in the picture is flashing. */
    strength: 2.5,
}

const QUAD_VERTEX = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`

/**
 * Keeps what throws light, at a quarter of the picture's size: only what is both bright and
 * warm. The cream lines of the drawing are bright too, and are left as they are.
 */
const BRIGHT_FRAGMENT = /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tInput;
    uniform vec2 uTexel;
    uniform float uThreshold;
    uniform float uKnee;
    void main() {
        vec3 colour = (
            texture2D(tInput, vUv + uTexel * vec2(-1.0, -1.0)).rgb +
            texture2D(tInput, vUv + uTexel * vec2(1.0, -1.0)).rgb +
            texture2D(tInput, vUv + uTexel * vec2(-1.0, 1.0)).rgb +
            texture2D(tInput, vUv + uTexel * vec2(1.0, 1.0)).rgb
        ) * 0.25;
        float brightest = max(colour.r, max(colour.g, colour.b));
        float warm = smoothstep(0.1, 0.3, (colour.r - colour.b) / max(brightest, 0.001));
        gl_FragColor = vec4(colour * warm * smoothstep(uThreshold, uThreshold + uKnee, brightest), 1.0);
    }
`

/** One pass of a blur along `uStep`: a gaussian for a glow, or a long even fall for a streak. */
const BLUR_FRAGMENT = /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tInput;
    uniform vec2 uStep;
    uniform float uLong;
    void main() {
        vec3 colour = vec3(0.0);
        if (uLong > 0.5) {
            float total = 0.0;
            for (int tap = -9; tap <= 9; tap++) {
                float weight = exp(-abs(float(tap)) * 0.3);
                colour += texture2D(tInput, vUv + uStep * float(tap)).rgb * weight;
                total += weight;
            }
            colour /= total;
        } else {
            colour = texture2D(tInput, vUv).rgb * 0.227027;
            colour += (texture2D(tInput, vUv + uStep * 1.384615).rgb + texture2D(tInput, vUv - uStep * 1.384615).rgb) * 0.316216;
            colour += (texture2D(tInput, vUv + uStep * 3.230769).rgb + texture2D(tInput, vUv - uStep * 3.230769).rgb) * 0.07027;
        }
        gl_FragColor = vec4(colour, 1.0);
    }
`

/** The light alone, to be added to the picture already on the canvas. */
const LIGHT_FRAGMENT = /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tGlow;
    uniform sampler2D tHalo;
    uniform sampler2D tStreak;
    uniform float uGlow;
    uniform float uHalo;
    uniform vec3 uHaloColour;
    uniform float uStreak;
    uniform vec3 uStreakColour;
    uniform float uStrength;
    void main() {
        vec3 light =
            texture2D(tGlow, vUv).rgb * uGlow +
            texture2D(tHalo, vUv).rgb * uHaloColour * uHalo +
            texture2D(tStreak, vUv).rgb * uStreakColour * uStreak;
        light *= uStrength;
        gl_FragColor = vec4(light, max(light.r, max(light.g, light.b)));
    }
`

interface Pass {
    material: ShaderMaterial
    render(renderer: WebGLRenderer, target: WebGLRenderTarget | null): void
}

/**
 * Light that spills, as it does through a lens onto film. Once the picture is on the canvas it
 * is copied, what is bright and warm in the copy is blurred three ways (a tight glow, a wide
 * coloured halo, a faint streak across), and that light is added over the picture. The picture
 * itself is not redrawn or changed.
 */
export function createGlow() {
    const quad = new Mesh(new PlaneGeometry(2, 2))
    quad.frustumCulled = false
    const quadScene = new Scene()
    quadScene.add(quad)
    const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

    function pass(fragmentShader: string, uniforms: Record<string, { value: unknown }>, additive = false): Pass {
        const material = new ShaderMaterial({
            vertexShader: QUAD_VERTEX,
            fragmentShader,
            uniforms,
            blending: additive ? AdditiveBlending : NoBlending,
            premultipliedAlpha: true,
            transparent: additive,
            depthTest: false,
            depthWrite: false,
        })
        return {
            material,
            render(renderer, target) {
                quad.material = material
                renderer.setRenderTarget(target)
                renderer.render(quadScene, quadCamera)
            },
        }
    }

    const soft = { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false }
    const [quarter, quarterSpare, streakTarget] = [0, 1, 2].map(() => new WebGLRenderTarget(4, 4, soft))
    const [eighth, eighthSpare] = [0, 1].map(() => new WebGLRenderTarget(4, 4, soft))
    let picture = new FramebufferTexture(4, 4)
    const origin = new Vector2()

    const bright = pass(BRIGHT_FRAGMENT, {
        tInput: { value: picture as Texture },
        uTexel: { value: new Vector2() },
        uThreshold: { value: LIGHT.threshold },
        uKnee: { value: LIGHT.knee },
    })
    const blur = pass(BLUR_FRAGMENT, {
        tInput: { value: null as Texture | null },
        uStep: { value: new Vector2() },
        uLong: { value: 0 },
    })
    const light = pass(
        LIGHT_FRAGMENT,
        {
            tGlow: { value: quarter.texture },
            tHalo: { value: eighth.texture },
            tStreak: { value: streakTarget.texture },
            uGlow: { value: LIGHT.glow },
            uHalo: { value: LIGHT.halo },
            uHaloColour: { value: new Color(LIGHT.haloColour) },
            uStreak: { value: LIGHT.streak },
            uStreakColour: { value: new Color(LIGHT.streakColour) },
            uStrength: { value: LIGHT.strength },
        },
        true
    )

    function blurred(
        renderer: WebGLRenderer,
        from: WebGLRenderTarget,
        to: WebGLRenderTarget,
        acrossTexels: number,
        downTexels: number,
        long = false
    ) {
        blur.material.uniforms.tInput.value = from.texture
        ;(blur.material.uniforms.uStep.value as Vector2).set(acrossTexels / from.width, downTexels / from.height)
        blur.material.uniforms.uLong.value = long ? 1 : 0
        blur.render(renderer, to)
    }

    return {
        /** How strong the light is against its usual: 1 at rest. */
        strengthen: (amount: number) => {
            light.material.uniforms.uStrength.value = LIGHT.strength * amount
        },
        /** Adds the light over the picture that has just been drawn on the canvas. */
        over: (renderer: WebGLRenderer, frame: Frame) => {
            if (picture.image.width !== frame.width || picture.image.height !== frame.height) {
                picture.dispose()
                picture = new FramebufferTexture(frame.width, frame.height)
                bright.material.uniforms.tInput.value = picture
                const [quarterWidth, quarterHeight] = [Math.ceil(frame.width / 4), Math.ceil(frame.height / 4)]
                for (const target of [quarter, quarterSpare, streakTarget]) target.setSize(quarterWidth, quarterHeight)
                for (const target of [eighth, eighthSpare])
                    target.setSize(Math.ceil(quarterWidth / 2), Math.ceil(quarterHeight / 2))
            }
            renderer.setRenderTarget(null)
            renderer.copyFramebufferToTexture(picture, origin)

            ;(bright.material.uniforms.uTexel.value as Vector2).set(1 / frame.width, 1 / frame.height)
            bright.render(renderer, quarter)
            // the streak is drawn from the sharp highlights, before they are softened
            blurred(renderer, quarter, quarterSpare, 2.4, 0, true)
            blurred(renderer, quarterSpare, streakTarget, 5.5, 0, true)
            blurred(renderer, quarter, quarterSpare, 1, 0)
            blurred(renderer, quarterSpare, quarter, 0, 1)
            blurred(renderer, quarter, eighthSpare, 1, 0)
            blurred(renderer, eighthSpare, eighth, 0, 1)
            blurred(renderer, eighth, eighthSpare, 2.2, 0)
            blurred(renderer, eighthSpare, eighth, 0, 2.2)

            light.render(renderer, null)
        },
        dispose: () => {
            picture.dispose()
            for (const target of [quarter, quarterSpare, streakTarget, eighth, eighthSpare]) target.dispose()
            for (const each of [bright, blur, light]) each.material.dispose()
            quad.geometry.dispose()
        },
    }
}
