import { SILK_SEED_OFFSET } from './field'

/**
 * The silk backdrop: one fullscreen triangle through one fragment shader.
 *
 * Raw WebGL rather than three.js - there is no scene graph or material system
 * to justify, and the vertex stage ignores every matrix three would hand it
 * (gl_Position is the raw attribute). The fragment shader reads only
 * gl_FragCoord and its own uniforms, so the same canvas size and viewport
 * always produce the same pixels.
 */
const VERT = 'attribute vec2 position;void main(){gl_Position=vec4(position,0.0,1.0);}'

const FRAG = `
      precision highp float;
      uniform float uTime,uScroll,uFade;
      uniform vec2 uRes,uMouse,uSeed;

      vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
      vec2 mod289(vec2 x){return x-floor(x*(1./289.))*289.;}
      vec3 permute(vec3 x){return mod289(((x*34.)+1.)*x);}
      float snoise(vec2 v){
        const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
        vec2 i=floor(v+dot(v,C.yy));
        vec2 x0=v-i+dot(i,C.xx);
        vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
        vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1;
        i=mod289(i);
        vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
        vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
        m=m*m; m=m*m;
        vec3 x=2.*fract(p*C.www)-1.;
        vec3 h=abs(x)-0.5;
        vec3 ox=floor(x+0.5);
        vec3 a0=x-ox;
        m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
        vec3 g;
        g.x=a0.x*x0.x+h.x*x0.y;
        g.yz=a0.yz*x12.xz+h.yz*x12.yw;
        return 130.*dot(m,g);
      }
      // warp fields: 2 octaves is plenty for a displacement field
      float fbm2(vec2 p){
        float f=0.,a=.5;
        for(int i=0;i<2;i++){ f+=a*snoise(p); p*=2.02; a*=.5; }
        return f*1.2917;   // renormalise 0.75 -> 0.96875
      }
      // the surface you actually see: keep the detail here
      float fbm4(vec2 p){
        float f=0.,a=.5;
        for(int i=0;i<4;i++){ f+=a*snoise(p); p*=2.02; a*=.5; }
        return f*1.0333;   // renormalise 0.9375 -> 0.96875
      }
      float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}

      void main(){
        vec2 frag = gl_FragCoord.xy/uRes.xy;
        vec2 uv = frag;
        uv.x *= uRes.x/uRes.y;
        uv *= 1.0 + uScroll*0.18;

        // the seed picks the region of the field we sample. it offsets the
        // noise domain only - the beam and vignette below stay in screen space.
        vec2 nuv = uv + uSeed;

        float t = uTime*0.038;
        vec2 m = (uMouse-0.5)*0.3;

        // large, slow silk folds - low frequency so it never fights the type
        vec2 q = vec2(fbm2(nuv*0.55 + t + m*0.5), fbm2(nuv*0.55 + vec2(5.2,1.3) - t*0.7));
        vec2 r = vec2(fbm2(nuv*0.55 + 1.15*q + vec2(1.7,9.2) + t*0.28),
                      fbm2(nuv*0.55 + 1.15*q + vec2(8.3,2.8) - t*0.22));
        float f = fbm4(nuv*0.55 + 1.05*r);

        // sheen: folds catching the light
        float sheen = smoothstep(0.18,1.0,f*0.5+0.5);
        sheen = pow(sheen, 3.6);
        float lightpool = smoothstep(0.0,0.72, q.y*0.5+0.5);
        sheen *= mix(0.35,1.0,lightpool);

        vec3 bone = vec3(0.917,0.902,0.863);
        vec3 gold = vec3(0.890,0.663,0.310);
        vec3 deep = vec3(0.019,0.019,0.024);
        vec3 char = vec3(0.10,0.095,0.10);

        vec3 col = mix(deep, char, smoothstep(-.45,.9,f));
        col += bone * sheen * 0.62;
        col += gold * pow(max(r.x,0.),2.6) * lightpool * 0.34;

        // projector beam from upper third, tracks the mouse
        vec2 beamC = vec2(uRes.x/uRes.y*0.74, 0.82) + m*0.4;
        float d = distance(uv, beamC);
        col += gold * exp(-d*d*2.0) * 0.17;
        col += bone * exp(-d*d*6.0) * 0.11;

        // vignette
        vec2 vc = frag - 0.5;
        col *= 1.0 - dot(vc,vc)*0.9;

        // quiet zone where the headline lives (lower-left), eases out on scroll
        float safe = smoothstep(0.62,0.05,frag.x) * smoothstep(0.85,0.15,frag.y);
        col *= 1.0 - safe*0.62*(1.0-uScroll);

        // scroll dim
        col *= mix(1.0, 0.24, uScroll);

        // dither - kill banding
        col += (hash(gl_FragCoord.xy + uTime)*2.0-1.0)/255.0 * 1.5;

        gl_FragColor = vec4(col*uFade, 1.0);
      }`

export type SilkRenderer = {
    /** The intro ramp. GSAP tweens this straight; the shader multiplies by it. */
    readonly fade: { value: number }
    resize(): void
    draw(t: number, pointerX: number, pointerY: number, scroll: number): void
    destroy(): void
}

/** Returns null when WebGL is unavailable - the caller falls back to contours. */
export function createSilk(canvas: HTMLCanvasElement): SilkRenderer | null {
    let gl: WebGLRenderingContext | null = null
    try {
        gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' })
    } catch {
        gl = null
    }
    if (!gl) return null
    const ctx = gl

    const compile = (type: number, src: string) => {
        const sh = ctx.createShader(type)
        if (!sh) throw new Error('createShader failed')
        ctx.shaderSource(sh, src)
        ctx.compileShader(sh)
        if (!ctx.getShaderParameter(sh, ctx.COMPILE_STATUS)) throw new Error(ctx.getShaderInfoLog(sh) ?? 'compile')
        return sh
    }

    let prog: WebGLProgram | null = null
    try {
        prog = ctx.createProgram()
        if (!prog) throw new Error('createProgram failed')
        ctx.attachShader(prog, compile(ctx.VERTEX_SHADER, VERT))
        ctx.attachShader(prog, compile(ctx.FRAGMENT_SHADER, FRAG))
        ctx.linkProgram(prog)
        if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) throw new Error(ctx.getProgramInfoLog(prog) ?? 'link')
    } catch (e) {
        console.warn('silk shader failed to build', e)
        return null
    }
    ctx.useProgram(prog)

    // one triangle large enough to cover the viewport - no quad, no index buffer
    const buf = ctx.createBuffer()
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buf)
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW)
    const aPos = ctx.getAttribLocation(prog, 'position')
    ctx.enableVertexAttribArray(aPos)
    ctx.vertexAttribPointer(aPos, 2, ctx.FLOAT, false, 0, 0)

    const program = prog
    const loc = (n: string) => ctx.getUniformLocation(program, n)
    const uTime = loc('uTime')
    const uRes = loc('uRes')
    const uMouse = loc('uMouse')
    const uScroll = loc('uScroll')
    const uFade = loc('uFade')
    const uSeed = loc('uSeed')
    ctx.uniform2f(uSeed, SILK_SEED_OFFSET[0], SILK_SEED_OFFSET[1])

    const fade = { value: 0 }
    let resX = 1
    let resY = 1
    // the pointer is smoothed here rather than by the caller: only the silk
    // wants the lag, and the smoothing has to advance with the frames it draws.
    const mouse = { x: 0.5, y: 0.5 }

    const resize = () => {
        const r = Math.min(devicePixelRatio, 1)
        canvas.width = Math.floor((canvas.clientWidth || innerWidth) * r)
        canvas.height = Math.floor((canvas.clientHeight || innerHeight) * r)
        ctx.viewport(0, 0, canvas.width, canvas.height)
        resX = canvas.width
        resY = canvas.height
    }
    resize()

    return {
        fade,
        resize,
        draw(t, pointerX, pointerY, scroll) {
            mouse.x += (pointerX - mouse.x) * 0.045
            mouse.y += (pointerY - mouse.y) * 0.045
            ctx.uniform1f(uTime, t)
            ctx.uniform2f(uRes, resX, resY)
            ctx.uniform2f(uMouse, mouse.x, mouse.y)
            ctx.uniform1f(uScroll, scroll)
            ctx.uniform1f(uFade, fade.value)
            ctx.drawArrays(ctx.TRIANGLES, 0, 3)
        },
        destroy() {
            ctx.deleteBuffer(buf)
            ctx.deleteProgram(program)
        },
    }
}
