import {
    BufferGeometry,
    CircleGeometry,
    Color,
    CustomBlending,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    LineSegments,
    MathUtils,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    type Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Plane,
    PlaneGeometry,
    Raycaster,
    Scene,
    ShaderMaterial,
    SrcAlphaFactor,
    Vector2,
    Vector3,
    type Vector4,
    type WebGLRenderer,
    ZeroFactor,
} from 'three'

import { makeBackdrop } from '@/app/components/home/cut-backdrop'
import {
    DUST_SPRITE_PIXELS,
    type DustSurface,
    makeRingDust,
    makeSettlingDust,
    makeStreamDust,
} from '@/app/components/home/cut-dust'
import { createGlow } from '@/app/components/home/cut-glow'
import { type LaptopDeck, deckMarkings } from '@/app/components/home/laptop-deck'
import { PALETTE, inkMaterials } from '@/app/components/home/looks'
import { approach, between, mix, smooth } from '@/app/components/home/motion'
import type { Frame, ViewportScene } from '@/app/components/home/viewport'
import {
    BODY_CENTRE,
    LENS_AXIS,
    LENS_FRONT_Z,
    MODEL_CENTRE,
    type RigPiece,
    SHUTTER_BUTTON_GROUP,
    createCameraRig,
    isLensPiece,
} from '@/app/components/scenes/camera-rig'
import { ANATOMY, isometricLayers } from '@/app/components/scenes/isometric-look'
import { type Model, type ModelPiece, loadModel } from '@/app/components/scenes/load-model'
import { lineMaterial } from '@/app/components/scenes/materials'
import { placeCamera } from '@/app/components/scenes/staging'
import { type Arrangement, type StandingItem, buildStudioSet, onArc } from '@/app/components/scenes/studio-set'

/** The page's sections, in order: the scene holds one shot for each and moves between them as they pass. */
export const CHAPTERS = [
    'hero',
    'fun',
    'menus',
    'delete',
    'link',
    'studio',
    'cut',
    'principles',
    'lens',
    'ring',
] as const
export type Chapter = (typeof CHAPTERS)[number]

export const CALLOUTS = ['aperture', 'focus', 'shutter', 'iso'] as const
export type Callout = (typeof CALLOUTS)[number]

/** What the scene needs of the page around it. */
export interface CutPage {
    /** The section of each chapter, in the order of CHAPTERS. */
    sections: HTMLElement[]
    /** Puts a callout's dot at a point on the canvas, in CSS pixels from its top left, `strength` 0..1 visible. */
    placeCallout(callout: Callout, x: number, y: number, strength: number): void
    setReading(callout: Callout, text: string): void
    /** A request someone has just typed, and the call Link makes for it, to print side by side. */
    logCall(request: string, call: string): void
    /** The camera has done what the last request asked. */
    answerCall(): void
    /** The next request has begun to be typed: it will be logged as a call when it is sent. */
    typeCall?(request: string): void
    /** Each 0..1, every frame: how far the first cut on the laptop has assembled, whether the camera is recording, and how much the words on the left lie over the picture and need it dimmed behind them. */
    showState(state: { cut: number; rolling: number; wordsOverPicture: number }): void
    /** Which chapter the picture is on, every frame: 2.5 is half way through the change from the third to the fourth. */
    showChapter(chapter: number): void
    /**
     * Where the four corners of the laptop's screen are on the canvas, in CSS pixels from its top
     * left (top left, top right, bottom right, bottom left), how wide the screen is for its
     * height, and how much shows of each thing that runs on it: Link's requests, and the first cut.
     */
    placeScreen(corners: number[], widthOverHeight: number, showing: { link: number; cut: number }): void
    /** The same for the monitor on the back of the camera, and how much of the errors piling up on it shows. */
    placeMonitor(corners: number[], widthOverHeight: number, strength: number): void
}

/**
 * Everything a shot fixes. Angles are degrees, lengths millimetres, shifts shares of the window,
 * the rest 0..1. Every one of them glides from a shot to the next.
 */
export interface Shot {
    azimuth: number
    elevation: number
    distance: number
    fieldOfView: number
    lookDown: number
    /** How far along the lens, past the camera, the view is aimed. */
    lookAhead: number
    /** How far right of the middle of the window the subject sits, and how far below it. */
    shiftRight: number
    shiftDown: number
    /** 1 stands the viewer square on to the lens, at the distance where its rim rings the closing words. */
    onLens: number
    /** 1 stands the viewer square on to the laptop's screen, close enough that it fills the window. */
    onScreen: number
    /** 1 aims the view at the director's chair instead of the camera. */
    onChair: number
    /** 1 aims the view at the controls on top of the grip, the shutter button among them, instead of the middle of the camera. */
    onControls: number
    /** How far the laptop has come in from beyond the right of the window, and how far it has gone from beside the camera to the crate on the set. */
    laptop: number
    laptopOnSet: number
    sway: number
    lines: number
    glassGlow: number
    /** How much of the whole drawing shows: less where words sit over it. */
    ink: number
    cut: number
    explode: number
    lensDetach: number
    lensTwist: number
    glassSpread: number
    /** Radians the monitor is swung out on its hinge. */
    screenOut: number
    busy: number
    deleted: number
    driven: number
    /** How far the studio's gear has gathered out of the dark around the camera. */
    gear: number
    lightsOn: number
    cameraScale: number
    rolling: number
    /** How far the ring the camera leaves has turned from its rim's cream to the closing ring's gold. */
    ring: number
    /** How far the camera has gone from a drawing to dust, and the dust from the whole camera to the rim of its lens. */
    swept: number
}

const SHOT_KEYS: (keyof Shot)[] = [
    'azimuth',
    'elevation',
    'distance',
    'fieldOfView',
    'lookDown',
    'lookAhead',
    'shiftRight',
    'shiftDown',
    'onLens',
    'onScreen',
    'onChair',
    'onControls',
    'laptop',
    'laptopOnSet',
    'sway',
    'lines',
    'glassGlow',
    'ink',
    'cut',
    'explode',
    'lensDetach',
    'lensTwist',
    'glassSpread',
    'screenOut',
    'busy',
    'deleted',
    'driven',
    'gear',
    'lightsOn',
    'cameraScale',
    'rolling',
    'ring',
    'swept',
]

const STUDIO_CAMERA_SCALE = 3.6

const BASE_SHOT: Shot = {
    azimuth: 38,
    elevation: 14,
    distance: 560,
    fieldOfView: 24,
    lookDown: 0,
    lookAhead: 0,
    shiftRight: 0.2,
    shiftDown: 0,
    onLens: 0,
    onScreen: 0,
    onChair: 0,
    onControls: 0,
    laptop: 0,
    laptopOnSet: 0,
    sway: 1,
    lines: 0.62,
    glassGlow: 0,
    ink: 1,
    cut: 0,
    explode: 0,
    lensDetach: 0,
    lensTwist: 0,
    glassSpread: 0,
    screenOut: 0,
    busy: 0,
    deleted: 0,
    driven: 0,
    gear: 0,
    lightsOn: 0,
    cameraScale: 1,
    rolling: 0,
    ring: 0,
    swept: 0,
}

const STUDIO_SHOT: Shot = {
    ...BASE_SHOT,
    azimuth: 222,
    elevation: 29,
    distance: 33000,
    fieldOfView: 12,
    lookDown: 230,
    lookAhead: 1250,
    shiftRight: 0.16,
    shiftDown: 0.05,
    gear: 1,
    lightsOn: 1,
    laptop: 1,
    laptopOnSet: 1,
    cameraScale: STUDIO_CAMERA_SCALE,
    lines: 0.5,
    sway: 0.25,
    rolling: 1,
}

/** The camera as it is drawn apart. */
const APART = { explode: 1, lensDetach: 0.25, glassSpread: 0.55, lensTwist: -0.5 }

/** Square on to the lens of the camera where it stands in the studio, at its studio size, with the gear gone. */
const LENS_SHOT: Shot = {
    ...BASE_SHOT,
    azimuth: 360,
    elevation: 0,
    shiftRight: 0,
    onLens: 1,
    lines: 0.42,
    glassGlow: 1,
    sway: 0.1,
    cameraScale: STUDIO_CAMERA_SCALE,
    laptop: 1,
    laptopOnSet: 1,
    swept: 1,
}

const SHOTS: Record<Chapter, Shot> = {
    hero: {
        ...BASE_SHOT,
        ...APART,
        azimuth: 38,
        elevation: 16,
        distance: 1120,
        shiftRight: 0.25,
        lookDown: 12,
        sway: 0.5,
    },
    // From over the photographer's shoulder, close on the top of the grip: the shutter button and the dials round it.
    fun: {
        ...BASE_SHOT,
        azimuth: 186,
        elevation: 56,
        distance: 215,
        shiftRight: 0.24,
        onControls: 1,
        sway: 0.2,
    },
    menus: { ...BASE_SHOT, azimuth: 204, elevation: 20, distance: 470, shiftRight: 0.2, busy: 1, sway: 0.3 },
    delete: { ...BASE_SHOT, azimuth: 216, elevation: 16, distance: 600, shiftRight: 0.2, deleted: 1, sway: 0.3 },
    link: {
        ...BASE_SHOT,
        azimuth: 328,
        elevation: 17,
        distance: 1000,
        shiftRight: -0.31,
        shiftDown: -0.1,
        lookDown: 20,
        driven: 1,
        laptop: 1,
        sway: 0.1,
    },
    studio: STUDIO_SHOT,
    cut: { ...STUDIO_SHOT, onScreen: 1, cut: 1, rolling: 0, sway: 0.04 },
    principles: {
        ...STUDIO_SHOT,
        azimuth: 250,
        elevation: 22,
        distance: 7200,
        lookDown: 0,
        lookAhead: 0,
        shiftRight: 0.22,
        shiftDown: 0.06,
        onChair: 1,
        rolling: 0,
        sway: 0.15,
    },
    lens: LENS_SHOT,
    ring: { ...LENS_SHOT, ring: 1 },
}

/**
 * Over which stretch of the way from the chapter before it each chapter is moved into: most hold
 * for the first and last three tenths and move between. The chair is a long scroll after the
 * first cut, its words being stepped through on the way, so the view is on it early, as those
 * words arrive. The last two move almost the whole way,
 * so the camera starts for its place while the principles are still up, and has gone to dust
 * and formed its ring by the time the closing words are in place.
 */
const USUAL_MOVE: [number, number] = [0.3, 0.7]
const MOVES: Partial<Record<Chapter, [number, number]>> = {
    principles: [0.17, 0.4],
    lens: [0.04, 0.96],
    ring: [0.03, 0.97],
}

/** Which chapter is at the middle of the window, as a number: 2.5 is halfway from the third to the fourth. */
function chapterAt(sections: HTMLElement[]): number {
    const middle = innerHeight / 2
    let previousCentre = 0
    for (let index = 0; index < sections.length; index++) {
        const bounds = sections[index].getBoundingClientRect()
        const centre = bounds.top + bounds.height / 2
        if (middle <= centre) {
            if (index === 0) return 0
            const [starts, ends] = MOVES[CHAPTERS[index]] ?? USUAL_MOVE
            const along = (middle - previousCentre) / (centre - previousCentre)
            return index - 1 + smooth((along - starts) / (ends - starts))
        }
        previousCentre = centre
    }
    return sections.length - 1
}

/** The parts the manifesto deletes: everything a hand would press or turn, and the monitor. It keeps the shutter button, which is part of the body, and the collar round it. */
const CONTROL_GROUPS = new Set([
    'keys',
    'reg1',
    'reg2',
    'reg3',
    'reg5',
    'reg6',
    'reg_iso',
    'screen',
    'screen_m',
    'screen_mount',
    'screen_mount2',
])
/** The middle of the controls on top of the grip, in the camera's own millimetres: between the shutter button at the front and the dials behind it. */
const TOP_CONTROLS = new Vector3(-40, 78, 12)
/** How far a deleted control travels before it is gone. */
const FLY_OFF_MILLIMETRES = 190

/** Where on the stage, in metres across and back from its middle, the camera's tripod stands. */
const TRIPOD_AT = { across: 0, back: -1.9 }
/** The underside of the camera body, in the model's millimetres. */
const CAMERA_BASE = new Vector3(0, BODY_CENTRE.y - 49, BODY_CENTRE.z)

const INTERVIEW: Arrangement = {
    aim: 'stage',
    stageMetres: 3.2,
    placements: [
        { id: 'chair', item: 'chair', across: 0, back: 0.05 },
        onArc('softbox', 148, 2.7, { id: 'softbox' }),
        onArc('parabolicLamp', 212, 2.9, { id: 'parabolicLamp' }),
        onArc('spotlight', 55, 3.0, { id: 'spotlight' }),
        onArc('floorLamp', -72, 2.4, { id: 'floorLamp' }),
        { id: 'ladder', item: 'ladder', across: 3.1, back: 1.7, turnDegrees: 60 },
        { id: 'crate', item: 'crate', across: -1.7, back: 3.0, turnDegrees: 25 },
        { id: 'lowerCase', item: 'case', across: -0.4, back: 3.4, turnDegrees: -30 },
        { id: 'cableReel', item: 'cableReel', across: 1.2, back: 3.0, turnDegrees: 50 },
    ],
}

const LIGHTS = ['softbox', 'parabolicLamp', 'spotlight', 'floorLamp']
/** The laptop stands on the crate, drawn this many times its size so it reads from across the studio, turned to face the viewer. */
const LAPTOP = { scale: 2.6, turnRadians: 0.73 + Math.PI }
/** Beside the camera in the Link chapter the laptop is nearer life size, to the viewer's right of it, turned to face the viewer. */
const LAPTOP_BY_CAMERA = { position: new Vector3(352, -160, 236), turnRadians: -0.5, scale: 1.08 }
/** The laptop gathers out of dust where it will stand, then its drawing comes up through the dust: shares of its arrival. */
const LAPTOP_ARRIVES = {
    dustFrom: 0.04,
    dustBy: 0.28,
    settlesFrom: 0.08,
    settlesBy: 0.74,
    drawnFrom: 0.64,
    drawnBy: 0.96,
    dustGoneFrom: 0.8,
}
const LAPTOP_POINTS = { wide: 16000, narrow: 9000 }
/** How far out into the dark the laptop's dust is thrown before it gathers, in the laptop's own millimetres. */
const LAPTOP_THROW_MILLIMETRES = 620
/** A call's particles take this share of the time between calls to reach the camera, which answers as they land. */
const STREAM_SHARE = 0.3
/** How far through the time between calls the next request starts being typed. */
const TYPING_FROM = 0.56
const STREAM_POINTS = 1600
/** How much of the window the laptop's screen fills when the viewer is square on to it. */
const SCREEN_SHARE_OF_WINDOW = 0.72
/** The screen sits a little below the middle of the window, clear of the sheet's slate. */
const SCREEN_SHIFT_DOWN = 0.035
/** The first cut assembles over this stretch of its sheet's passage through the window: from while the view is still closing in on the laptop to the middle of its stay there. */
const CUT_ASSEMBLES = { from: 0.08, by: 0.5 }
/** The lights whose head turns on its stand; the floor lamp turns bodily. */
const PANNING_ITEMS = ['softbox', 'spotlight', 'parabolicLamp']
const MOST_TIP_RADIANS = 0.32
const POOL_OPACITY = 0.1
const BEAM_OPACITY = 0.055
/** How far the pointer can pull the lights' aim off the chair. */
const AIM_REACH_MILLIMETRES = 650
const POOL_RADIUS_MILLIMETRES = 760
const BEAM_STEPS = 40
/** The lights come on one after another once the studio has formed, this long apart. */
const LIGHT_UP_SECONDS = 0.32

/** Turns a light to face a point on the floor of the set, given in the gear's millimetres. */
function faceThePoint(item: StandingItem, across: number, back: number) {
    const towards = Math.atan2(across - item.home.x, back - item.home.z)
    const turn = MathUtils.euclideanModulo(towards - item.homeTurn + Math.PI, Math.PI * 2) - Math.PI
    if (PANNING_ITEMS.includes(item.placement.item)) item.rig.pose.pan = turn
    else item.rig.root.rotation.y = item.homeTurn + turn
    const away = Math.hypot(across - item.home.x, back - item.home.z)
    item.rig.pose.tilt = MathUtils.clamp(((away - 2900) / 1000) * 0.16, -MOST_TIP_RADIANS, MOST_TIP_RADIANS)
}

/** A flat gold disc lying on the floor among the gear. */
function floorPool(): Mesh<CircleGeometry, MeshBasicMaterial> {
    const pool = new Mesh(
        new CircleGeometry(1, 56),
        new MeshBasicMaterial({
            color: ANATOMY.lit,
            transparent: true,
            opacity: 0,
            side: DoubleSide,
            depthWrite: false,
        })
    )
    pool.rotation.x = -Math.PI / 2
    pool.position.y = 3
    pool.scale.setScalar(POOL_RADIUS_MILLIMETRES)
    return pool
}

/** A shaft of light as a flat gold cone, from a lamp's face down to its pool on the floor. */
function lightBeam(): { mesh: Mesh; reach(from: Vector3, pool: Vector3, radius: number): void } {
    const positions = new Float32BufferAttribute(new Float32Array((BEAM_STEPS + 1) * 3), 3)
    const fan: number[] = []
    for (let step = 0; step < BEAM_STEPS; step++) fan.push(0, 1 + step, 1 + ((step + 1) % BEAM_STEPS))
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', positions)
    geometry.setIndex(fan)
    const mesh = new Mesh(
        geometry,
        new MeshBasicMaterial({
            color: ANATOMY.lit,
            transparent: true,
            opacity: BEAM_OPACITY,
            side: DoubleSide,
            depthWrite: false,
        })
    )
    mesh.frustumCulled = false
    return {
        mesh,
        reach(from, pool, radius) {
            positions.setXYZ(0, from.x, from.y, from.z)
            for (let step = 0; step < BEAM_STEPS; step++) {
                const angle = (step / BEAM_STEPS) * Math.PI * 2
                positions.setXYZ(1 + step, pool.x + Math.cos(angle) * radius, pool.y, pool.z + Math.sin(angle) * radius)
            }
            positions.needsUpdate = true
        },
    }
}

/** The mesh that draws a part somewhere under `root`. */
function meshDrawing(root: Object3D, piece: ModelPiece): Object3D | undefined {
    let found: Object3D | undefined
    root.traverse(child => {
        if (!found && (child as Mesh).isMesh && (child as Mesh).geometry === piece.solid) found = child
    })
    return found
}

function easeOutBack(value: number): number {
    const clamped = MathUtils.clamp(value, 0, 1)
    const overshoot = 1.70158
    return 1 + (overshoot + 1) * Math.pow(clamped - 1, 3) + overshoot * Math.pow(clamped - 1, 2)
}

/** A dial that clicks one detent every `stepSeconds`, snapping with a little overshoot. */
function detents(seconds: number, stepSeconds: number, stepRadians: number): number {
    const step = Math.floor(seconds / stepSeconds)
    const within = (seconds / stepSeconds - step) / 0.35
    return (step + easeOutBack(within)) * stepRadians
}

/** The shutter button in the close-up of the controls: the drawing's own dark fill and pale line, turned a little to red. */
const RECORD_RED = {
    shadow: new Color('#1c0a09'),
    light: new Color('#55201a'),
    line: new Color('#ee7f72'),
    lineOpacity: 0.85,
}

/** How often the shutter button is pressed in the close-up of the controls, and how long one press takes to go down and come back, in seconds. */
const SHUTTER_PRESSED_EVERY_SECONDS = 1
const SHUTTER_PRESS_SECONDS = 0.34

/** How far down a press is, 0..1, this many seconds after it began. */
function pressAt(seconds: number): number {
    return seconds < SHUTTER_PRESS_SECONDS ? Math.sin((seconds / SHUTTER_PRESS_SECONDS) * Math.PI) : 0
}

/** A ring with stops at both ends: it clicks `clicks` detents one way, one every `stepSeconds`, and then back again. */
function detentsThereAndBack(seconds: number, stepSeconds: number, stepRadians: number, clicks: number): number {
    const step = Math.floor(seconds / stepSeconds)
    const within = (seconds / stepSeconds - step) / 0.35
    const clicksAt = (count: number) => clicks - Math.abs((count % (clicks * 2)) - clicks)
    return mix(clicksAt(step), clicksAt(step + 1), easeOutBack(within)) * stepRadians
}

/** A surface's corners moved by a matrix, as a surface the dust can stand on. */
function surfaceOf(piece: ModelPiece, matrix: Matrix4, weight: number, tint: number): DustSurface {
    const local = piece.solid.getAttribute('position').array as Float32Array
    const positions = new Float32Array(local.length)
    const corner = new Vector3()
    for (let index = 0; index < local.length; index += 3)
        corner.fromArray(local, index).applyMatrix4(matrix).toArray(positions, index)
    return { positions, triangles: piece.solid.getIndex()!.array, weight, tint }
}

/** What Link does to the camera in the Link chapter: one call every two seconds, round and round. */
const CALL_SECONDS = 2
const DRIVEN_CALLS = [
    {
        callout: 'aperture',
        values: ['f/2.8', 'f/4', 'f/5.6', 'f/8'],
        request: (value: string) => `Set the aperture to ${value}`,
        call: (value: string) => `camera.setAperture('${value}')`,
    },
    {
        callout: 'shutter',
        values: ['1/60', '1/125', '1/250', '1/500'],
        request: (value: string) => `Shutter speed ${value}`,
        call: (value: string) => `camera.setShutterSpeed('${value}')`,
    },
    {
        callout: 'iso',
        values: ['100', '200', '400', '800'],
        request: (value: string) => `ISO ${value}`,
        call: (value: string) => `camera.setIso('${value}')`,
    },
    {
        callout: 'focus',
        values: ['AF-S', 'AF-S', 'AF-S', 'AF-S'],
        request: () => 'Focus',
        call: () => 'camera.autofocus()',
    },
    {
        callout: 'capture',
        values: ['', '', '', ''],
        request: () => 'Take the shot',
        call: () => 'camera.captureImage()',
    },
] as const

const NARROW_WINDOW_PIXELS = 900
/** On a phone the camera sits in the top third of the window, above the words, and further off so it fits. */
const NARROW_SHIFT_DOWN = -0.3
const NARROW_DISTANCE_FACTOR = 2.7
/** How far through the move to the lens the viewer starts for the middle of the window and up close. */
const CLOSING_IN_FROM = 0.45
const ARRIVING_LATE: (keyof Shot)[] = ['onLens', 'shiftRight', 'distance', 'fieldOfView']
/** How much of a half window the lens rim spans when the viewer stands square on to it. */
const RIM_SHARE_OF_HALF_HEIGHT = 0.82
const RIM_SHARE_OF_HALF_WIDTH = { wide: 0.6, narrow: 0.86 }
const RING_POINTS = { wide: 110000, narrow: 60000 }
const GEAR_POINTS = { wide: 60000, narrow: 30000 }
/** How far out into the dark the gear's dust is thrown before it gathers. */
const GEAR_THROW_MILLIMETRES = 5200
/** The gear gathers as dust, then its drawing comes up through it: shares of its arrival. */
const GEAR = {
    dustFrom: 0.1,
    dustBy: 0.36,
    settlesFrom: 0.14,
    settlesBy: 0.8,
    drawnFrom: 0.72,
    drawnBy: 0.97,
    dustGoneFrom: 0.82,
}
/** The camera goes to dust, and the dust to the ring: shares of the last change. */
/**
 * How the camera goes to the ring, as shares of the move from the chair to the lens: its drawing
 * gives way to dust at once, with the gear's; then a wave puts the dust out from the back of the
 * camera to the front of its lens; and as the last of it goes the ring comes up where the rim was.
 */
const DISSOLVE = {
    dustBy: 0.14,
    drawingGoneFrom: 0.02,
    drawingGoneBy: 0.18,
    waveFrom: 0.26,
    waveBy: 0.96,
    ringFrom: 0.74,
}
/** How far behind the camera the wave starts and how far past its front it ends, in the camera's millimetres, so the first point is whole and the last is out. */
const WAVE_MARGIN_MILLIMETRES = 16

const scratchMatrix = new Matrix4()
const scratchVector = new Vector3()
const projected = new Vector3()

/** A sheet over the whole canvas that keeps `uKeep` of what is already drawn, colour and coverage alike. */
function fadeSheet(): { scene: Scene; camera: OrthographicCamera; material: ShaderMaterial } {
    const material = new ShaderMaterial({
        uniforms: { uKeep: { value: 1 } },
        vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: /* glsl */ `uniform float uKeep; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, uKeep); }`,
        blending: CustomBlending,
        blendSrc: ZeroFactor,
        blendDst: SrcAlphaFactor,
        blendSrcAlpha: ZeroFactor,
        blendDstAlpha: SrcAlphaFactor,
        depthTest: false,
        depthWrite: false,
        transparent: true,
    })
    const sheet = new Mesh(new PlaneGeometry(2, 2), material)
    sheet.frustumCulled = false
    const scene = new Scene()
    scene.add(sheet)
    return { scene, camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1), material }
}

/** The widest the front of the lens is, from its axis: the rim the closing ring takes over from. */
function lensRimRadius(model: Model): number {
    let radius = 0
    for (const piece of model.pieces) {
        if (!isLensPiece(piece) || piece.bounds.max.z < LENS_FRONT_Z - 12) continue
        radius = Math.max(radius, piece.bounds.max.x - LENS_AXIS.x, LENS_AXIS.x - piece.bounds.min.x)
    }
    return radius
}

/** The laptop's display, in the laptop's own millimetres: its middle, the way it faces, its corners, and its shape. */
interface LaptopScreen {
    centre: Vector3
    normal: Vector3
    /** Top left, top right, bottom right, bottom left, as someone facing the screen sees them. */
    corners: Vector3[]
    height: number
    widthOverHeight: number
    /** The top of the laptop's base, for what is drawn on it. */
    deck: LaptopDeck
}

/** How far in from the lid's edges the display's own edge is, and how far above the keyboard its foot is, in the laptop's millimetres. */
const DISPLAY = { inset: 3, aboveDeck: 2.6 }
/** A point of the laptop's body this far in front of its lid is part of the deck, not of the lid. */
const CLEAR_OF_THE_LID_MILLIMETRES = 40

/**
 * Finds the display on the laptop. The flat part drawn as lit is the whole inner face of its
 * lid; the display is that face set in a little from the lid's edges and ending above the deck.
 */
function screenOf(model: Model): LaptopScreen {
    const lid = model.pieces.find(piece => piece.surface === 'element')
    if (!lid) throw new Error('The laptop has no screen')
    const positions = lid.solid.getAttribute('position')
    const triangles = lid.solid.getIndex()!
    const corner = (index: number) => new Vector3().fromBufferAttribute(positions, triangles.getX(index))
    const normal = corner(1)
        .sub(corner(0))
        .cross(corner(2).sub(corner(0)))
        .normalize()
    const up = new Vector3(0, 1, 0).addScaledVector(normal, -normal.y).normalize()
    const right = new Vector3().crossVectors(up, normal)
    let [left, rightmost, bottom, top] = [Infinity, -Infinity, Infinity, -Infinity]
    const vertex = new Vector3()
    for (let index = 0; index < positions.count; index++) {
        vertex.fromBufferAttribute(positions, index).sub(lid.centre)
        left = Math.min(left, vertex.dot(right))
        rightmost = Math.max(rightmost, vertex.dot(right))
        bottom = Math.min(bottom, vertex.dot(up))
        top = Math.max(top, vertex.dot(up))
    }
    // The lid's face runs on down behind the keyboard: the display ends a little above where the deck's top meets it.
    const body = model.pieces.find(piece => piece.surface !== 'element')
    if (!body) throw new Error('The laptop has no body')
    const bodyPositions = body.solid.getAttribute('position')
    let deckTop = -Infinity
    for (let index = 0; index < bodyPositions.count; index++) {
        vertex.fromBufferAttribute(bodyPositions, index)
        if (vertex.clone().sub(lid.centre).dot(normal) > CLEAR_OF_THE_LID_MILLIMETRES)
            deckTop = Math.max(deckTop, vertex.y)
    }
    left += DISPLAY.inset
    rightmost -= DISPLAY.inset
    top -= DISPLAY.inset
    const lidMeetsDeck = (deckTop - lid.centre.y) / up.y
    bottom = lidMeetsDeck + DISPLAY.aboveDeck
    const deck: LaptopDeck = {
        halfWidth: body.bounds.max.x,
        hingeZ: lid.centre.z + up.z * lidMeetsDeck,
        frontZ: body.bounds.max.z,
        topY: deckTop,
    }
    const at = (across: number, upwards: number) =>
        lid.centre.clone().addScaledVector(right, across).addScaledVector(up, upwards)
    return {
        centre: at((left + rightmost) / 2, (bottom + top) / 2),
        normal,
        corners: [at(left, top), at(rightmost, top), at(rightmost, bottom), at(left, bottom)],
        height: top - bottom,
        widthOverHeight: (rightmost - left) / (top - bottom),
        deck,
    }
}

/**
 * The whole page's picture. One camera that every section moves, drawn in line from first to
 * last; a studio whose gear gathers out of dust around it and scatters again; and an ending
 * where the camera itself goes to dust and the dust to a ring where its lens was.
 */
export async function buildCutScene(page: CutPage): Promise<ViewportScene> {
    const [cameraModel, studioModel, laptopModel] = await Promise.all([
        loadModel('camera'),
        loadModel('studio'),
        loadModel('laptop'),
    ])
    const cameraScene = new Scene()
    const gearScene = new Scene()
    const viewer = new PerspectiveCamera(24, 1, 10, 9000)
    const ink = inkMaterials({ rim: PALETTE.gold, rimStrength: 0.1 })
    // The shutter button is drawn in materials of its own, the same as the rest until the close-up of the controls turns them red.
    const record = inkMaterials({ rim: PALETTE.gold, rimStrength: 0.1 })
    const recordAtRest = {
        shadow: (record.fill.uniforms.uShadow.value as Color).clone(),
        light: (record.fill.uniforms.uLight.value as Color).clone(),
        line: record.ink.color.clone(),
    }
    const rig = createCameraRig(cameraModel, piece =>
        piece.group === SHUTTER_BUTTON_GROUP ? record.look(piece) : ink.look(piece)
    )
    const shot: Shot = { ...BASE_SHOT }
    const restingGlassLight = (ink.glassFill.uniforms.uLight.value as Color).clone()
    const glowingGlassLight = new Color('#2f2614')
    const backdrop = makeBackdrop()
    const glow = createGlow()
    const rimRadius = lensRimRadius(cameraModel)
    const cameraDepth = cameraModel.pieces.reduce(
        (depth, piece) => ({
            back: Math.min(depth.back, piece.bounds.min.z),
            front: Math.max(depth.front, piece.bounds.max.z),
        }),
        { back: Infinity, front: -Infinity }
    )
    const lensFront = new Vector3(LENS_AXIS.x, LENS_AXIS.y, LENS_FRONT_Z)
    const narrowWindow = innerWidth < NARROW_WINDOW_PIXELS

    // Each control leaves a little after the one before it, straight out from the body, and shrinks to nothing once clear.
    const flyOffOrder = new Map(
        rig.pieces
            .filter(rigPiece => CONTROL_GROUPS.has(rigPiece.piece.group))
            .map((rigPiece, index, controls) => [rigPiece, ((index * 7) % controls.length) / controls.length])
    )
    rig.perPiece = (rigPiece: RigPiece, matrix: Matrix4) => {
        // The rig lifts the glass clear of the barrel when the camera is drawn apart; here it stays on the lens's own line.
        if (rigPiece.piece.surface === 'element' && rig.pose.explode !== 0)
            matrix.premultiply(scratchMatrix.makeTranslation(0, -rigPiece.explodeOffset.y * rig.pose.explode, 0))
        const order = flyOffOrder.get(rigPiece)
        if (order === undefined || shot.deleted <= 0.001) return
        const gone = smooth(shot.deleted * 1.4 - order * 0.4)
        if (gone <= 0) return
        const { centre } = rigPiece.piece
        const away = scratchVector
            .copy(rigPiece.explodeOffset)
            .normalize()
            .multiplyScalar(FLY_OFF_MILLIMETRES * gone)
        // Moved in the camera's own frame, after the part's pose: a turning dial flies straight, not round its axle.
        matrix.premultiply(scratchMatrix.makeTranslation(away.x, away.y, away.z))
        const size = Math.max(0.0001, 1 - between(gone, 0.5, 1))
        if (size >= 1) return
        matrix
            .multiply(scratchMatrix.makeTranslation(centre.x, centre.y, centre.z))
            .multiply(scratchMatrix.makeScale(size, size, size))
            .multiply(scratchMatrix.makeTranslation(-centre.x, -centre.y, -centre.z))
    }

    // The glass of the monitor on the camera's back: seen from behind, its top left is at the camera's highest x.
    const monitorPart = rig.pieces.find(
        rigPiece => rigPiece.piece.group === 'screen' && rigPiece.piece.surface === 'glass'
    )
    if (!monitorPart) throw new Error('The camera has no monitor glass')
    const glass = monitorPart.piece.bounds
    const monitor = {
        part: monitorPart,
        corners: [
            new Vector3(glass.max.x, glass.max.y, glass.min.z),
            new Vector3(glass.min.x, glass.max.y, glass.min.z),
            new Vector3(glass.min.x, glass.min.y, glass.min.z),
            new Vector3(glass.max.x, glass.min.y, glass.min.z),
        ],
        widthOverHeight: (glass.max.x - glass.min.x) / (glass.max.y - glass.min.y),
    }

    const cameraMount = new Group()
    cameraMount.add(rig.root)
    cameraScene.add(cameraMount)

    // The camera stands on the parabolic lamp's own tripod, and the studio is stood so that tripod's foot is on its floor.
    const layers = isometricLayers()
    const tripodPiece = studioModel.pieces.find(piece => piece.group === 'parabolicLamp' && piece.name === 'tripod')
    const tripodHead = studioModel.joints.find(joint => joint.item === 'parabolicLamp' && joint.name === 'pan')
    if (!tripodPiece || !tripodHead) throw new Error('The studio kit has no parabolic lamp tripod')
    const tripodHeight = tripodPiece.bounds.max.y
    const stand = new Group()
    stand.add(...layers.plain(tripodPiece))
    stand.position.set(
        CAMERA_BASE.x - tripodHead.origin[0],
        CAMERA_BASE.y - tripodHeight,
        CAMERA_BASE.z - tripodHead.origin[2]
    )

    const set = buildStudioSet(studioModel, INTERVIEW)
    const studioMount = new Group()
    studioMount.add(set.turntable)
    gearScene.add(studioMount, stand)
    studioMount.rotation.y = -Math.PI / 4
    studioMount.updateMatrixWorld(true)
    studioMount.position
        .copy(CAMERA_BASE)
        .sub(set.gear.localToWorld(new Vector3(TRIPOD_AT.across * 1000, tripodHeight, TRIPOD_AT.back * 1000)))
    studioMount.updateMatrixWorld(true)
    const floorY = set.gear.localToWorld(new Vector3()).y
    const floor = new Plane(new Vector3(0, 1, 0), -floorY)

    const lights = LIGHTS.map(id => set.byId(id))
    const chair = set.byId('chair')

    const crate = set.byId('crate')
    const laptop = new Group()
    for (const piece of laptopModel.pieces)
        laptop.add(...(piece.surface === 'element' ? layers.gold(piece) : layers.plain(piece)))
    const screen = screenOf(laptopModel)
    laptop.add(new LineSegments(deckMarkings(screen.deck), lineMaterial(ANATOMY.crease, 0.85)))
    // Where the laptop stands on the set: on top of the crate. The gear's frame is turned to the world's, so its turn is the same in both.
    const laptopOnCrate = set.gear.localToWorld(new Vector3(crate.home.x, crate.rig.size.y, crate.home.z))
    const pools = lights.map(() => floorPool())
    const beams = lights.map(light => {
        const face = studioModel.pieces.find(
            piece => piece.group === light.placement.item && piece.surface === 'element'
        )
        return { ...lightBeam(), face, head: face ? meshDrawing(light.rig.root, face) : undefined }
    })
    set.gear.add(...pools, ...beams.map(beam => beam.mesh))
    const aim = new Vector2(chair.home.x, chair.home.z)
    const raycaster = new Raycaster()
    const pointerOnFloor = new Vector3()
    const pointerInView = new Vector2()
    const headAt = new Vector3()

    const gearDust = makeSettlingDust(
        narrowWindow ? GEAR_POINTS.narrow : GEAR_POINTS.wide,
        gearSurfaces(),
        GEAR_THROW_MILLIMETRES
    )
    const ringDust = makeRingDust(
        narrowWindow ? RING_POINTS.narrow : RING_POINTS.wide,
        rig.pieces.map(rigPiece =>
            surfaceOf(
                rigPiece.piece,
                scratchMatrix.identity(),
                rigPiece.piece.surface === 'element' ? 0.45 : 1,
                rigPiece.piece.surface === 'element' ? 1 : 0
            )
        )
    )
    const stream = makeStreamDust(STREAM_POINTS)
    // The laptop's dust is laid on the laptop as it is modelled, and is then stood wherever the laptop stands.
    const laptopDust = makeSettlingDust(
        narrowWindow ? LAPTOP_POINTS.narrow : LAPTOP_POINTS.wide,
        laptopModel.pieces.map(piece =>
            surfaceOf(
                piece,
                scratchMatrix.identity(),
                piece.surface === 'element' ? 2 : 1,
                piece.surface === 'element' ? 1 : 0
            )
        ),
        LAPTOP_THROW_MILLIMETRES
    )
    const laptopScene = new Scene()
    const dustScene = new Scene()
    dustScene.add(gearDust.points, ringDust.points, stream.points, laptopDust.points)
    const fade = fadeSheet()
    const ringPlane = new Plane()
    const stirAt = new Vector3()
    let stirStrength = 0

    /** Every surface of the gear as it stands on the set, tripod included, for its dust to gather on. */
    function gearSurfaces(): DustSurface[] {
        set.rest()
        // The lights are aimed at the chair, as they are while the gear gathers: dust laid on a light at rest would hang beside it.
        for (const light of lights) faceThePoint(light, chair.home.x, chair.home.z)
        set.update()
        gearScene.updateMatrixWorld(true)
        const surfaces: DustSurface[] = [surfaceOf(tripodPiece!, stand.matrixWorld, 1, 0)]
        for (const item of set.items) {
            for (const piece of studioModel.pieces.filter(candidate => candidate.group === item.placement.item)) {
                const mesh = meshDrawing(item.rig.root, piece)
                if (mesh)
                    surfaces.push(
                        surfaceOf(
                            piece,
                            mesh.matrixWorld,
                            piece.surface === 'element' ? 7 : 1,
                            piece.surface === 'element' ? 1 : 0
                        )
                    )
            }
        }
        return surfaces
    }

    const target = new Vector3()
    const screenCentre = new Vector3()
    const chairSeat = new Vector3()
    const lensFrontInView = new Vector3()
    const controlsInView = new Vector3()
    /** How far the view's aim has swung from where the shot looks to the front of the lens: ahead of `shot.onLens`, which brings the viewer in. */
    let aimedAtLens = 0
    const screenOutwards = new Vector3()
    const viewerFrom = new Vector3()
    const cutSection = page.sections[CHAPTERS.indexOf('cut')]
    const turned = {
        busySeconds: 0,
        callSeconds: 0,
        aperture: 0,
        apertureTo: 0,
        rear: 0,
        rearTo: 0,
        exposure: 0,
        exposureTo: 0,
    }
    let chapter = chapterAt(page.sections)
    let lastCall = -1
    let lastAnswer = -1
    let lastTyped = -1
    let streamTo: Callout | 'capture' = 'aperture'
    let flash = 0
    let studioSeconds = 0

    /**
     * Makes the next of Link's calls when its turn comes. The request and its call are printed at
     * once and a burst of particles leaves the laptop; the camera answers as they land.
     */
    /** The words of the request made at a step of the round of calls. */
    function wordingOf(step: number): string {
        const made = DRIVEN_CALLS[step % DRIVEN_CALLS.length]
        const value = made.values[Math.floor(step / DRIVEN_CALLS.length) % made.values.length]
        return made.request(value)
    }

    function driveTheCamera(frame: Frame) {
        const { pose } = rig
        if (shot.driven > 0.5 && !frame.still) turned.callSeconds += frame.deltaSeconds
        const step = Math.floor(turned.callSeconds / CALL_SECONDS)
        const within = turned.callSeconds / CALL_SECONDS - step
        const turn = step % DRIVEN_CALLS.length
        const made = DRIVEN_CALLS[turn]
        const value = made.values[Math.floor(step / DRIVEN_CALLS.length) % made.values.length]
        const answering = within - STREAM_SHARE
        pose.focusRing +=
            (turn === 3 ? Math.sin(MathUtils.clamp(answering / 0.5, 0, 1) * Math.PI) : 0) * 0.9 * shot.driven
        pose.shutterPress = Math.max(
            pose.shutterPress,
            (turn === 4 ? Math.sin(MathUtils.clamp(answering / 0.2, 0, 1) * Math.PI) : 0) * shot.driven
        )
        stream.material.uniforms.uProgress.value = within / STREAM_SHARE
        if (shot.driven <= 0.5) return
        if (step !== lastCall) {
            lastCall = step
            streamTo = made.callout
            page.logCall(wordingOf(step), made.call(value))
        }
        if (within >= TYPING_FROM && step !== lastTyped) {
            lastTyped = step
            page.typeCall?.(wordingOf(step + 1))
        }
        if (answering < 0 || step === lastAnswer) return
        lastAnswer = step
        if (turn === 0) turned.apertureTo += 0.32
        if (turn === 1) turned.rearTo += 0.52
        if (turn === 2) turned.exposureTo -= 0.52
        if (made.callout === 'capture') flash = 1
        else page.setReading(made.callout, value)
        page.answerCall()
    }

    function poseTheCamera(frame: Frame) {
        const { pose } = rig
        const { seconds, deltaSeconds } = frame
        // Everything that keeps turning is added to as it turns, so it stops where it is when its chapter ends and never winds back.
        turned.busySeconds += deltaSeconds * shot.busy
        turned.aperture = approach(turned.aperture, turned.apertureTo, 9, deltaSeconds)
        turned.rear = approach(turned.rear, turned.rearTo, 9, deltaSeconds)
        turned.exposure = approach(turned.exposure, turned.exposureTo, 9, deltaSeconds)
        pose.explode = shot.explode
        pose.lensDetach = shot.lensDetach
        pose.lensTwist = shot.lensTwist
        pose.glassSpread = shot.glassSpread
        // The hinge is on the grip's far side: a negative turn swings the monitor out behind the camera.
        pose.screenFlip = -shot.screenOut
        pose.modeDial = detents(turned.busySeconds, 0.5, 0.42)
        pose.controlWheel = turned.busySeconds * 3.2
        pose.rearDial = turned.rear - detents(turned.busySeconds + 0.2, 0.35, 0.5)
        pose.exposureDial = turned.exposure + detents(turned.busySeconds + 0.1, 0.42, 0.5)
        // While every control is being worked the rings are too: the focus hunts, the zoom runs out and back, the aperture clicks to one end and then the other. Each stops where it is when the chapter ends, but the barrel draws back in.
        const zoomed = Math.sin(turned.busySeconds * 1.15 + 0.7)
        pose.focusRing = Math.sin(turned.busySeconds * 2.7) * 0.5 + Math.sin(turned.busySeconds * 6.1 + 1) * 0.16
        pose.apertureRing = turned.aperture + detentsThereAndBack(turned.busySeconds + 0.3, 0.38, 0.17, 5)
        pose.zoomRing = Math.sin(seconds * 0.5) * 0.3 * shot.driven + zoomed * 0.5
        pose.zoomExtension =
            (0.5 + 0.5 * Math.sin(seconds * 0.5)) * shot.driven * 0.6 + (0.5 + 0.5 * zoomed) * 0.7 * shot.busy
        pose.keysPress = 0
        // Close on the controls, the shutter button is pressed once a second.
        pose.shutterPress = shot.onControls * pressAt(seconds % SHUTTER_PRESSED_EVERY_SECONDS)
        pose.keysBusy = shot.busy
        pose.keysBusySeconds = turned.busySeconds
        driveTheCamera(frame)
        rig.update()
        cameraMount.scale.setScalar(shot.cameraScale)
        cameraMount.position.copy(CAMERA_BASE).multiplyScalar(1 - shot.cameraScale)
        cameraMount.updateMatrixWorld(true)
    }

    function poseTheStudio(frame: Frame, drawn: number) {
        studioSeconds = drawn > 0.5 ? studioSeconds + frame.deltaSeconds : 0
        if (drawn <= 0.004) return
        set.rest()

        // The lights rest on the chair; the pointer can pull them a little way across the stage.
        let [across, back] = [chair.home.x, chair.home.z]
        if (frame.pointerSeen) {
            raycaster.setFromCamera(pointerInView.set(frame.pointer.x, -frame.pointer.y), viewer)
            if (raycaster.ray.intersectPlane(floor, pointerOnFloor)) {
                set.gear.worldToLocal(pointerOnFloor)
                // The pointer has no pull until the gear has gathered: until then the lights stay where their dust is settling.
                const pull =
                    Math.min(
                        1,
                        AIM_REACH_MILLIMETRES /
                            Math.max(1, Math.hypot(pointerOnFloor.x - across, pointerOnFloor.z - back))
                    ) * between(shot.gear, 0.92, 1)
                across += (pointerOnFloor.x - across) * pull
                back += (pointerOnFloor.z - back) * pull
            }
        }
        aim.set(approach(aim.x, across, 5, frame.deltaSeconds), approach(aim.y, back, 5, frame.deltaSeconds))
        lights.forEach((light, index) => {
            faceThePoint(light, aim.x, aim.y)
            const on =
                shot.lightsOn > (index + 0.5) / lights.length &&
                (frame.still || studioSeconds > 0.2 + index * LIGHT_UP_SECONDS)
            light.rig.lit = on
            // Each pool lies a little towards its own light from where the light is aimed.
            pools[index].position.x = aim.x + (light.home.x - aim.x) * 0.13
            pools[index].position.z = aim.y + (light.home.z - aim.y) * 0.13
            pools[index].material.opacity = on ? POOL_OPACITY : 0
            beams[index].mesh.visible = on
        })
        set.update()
        set.gear.updateMatrixWorld(true)
        beams.forEach((beam, index) => {
            if (!beam.mesh.visible || !beam.face || !beam.head) return
            set.gear.worldToLocal(beam.head.localToWorld(headAt.copy(beam.face.centre)))
            beam.reach(headAt, pools[index].position, POOL_RADIUS_MILLIMETRES)
        })
    }

    function placeTheViewer(frame: Frame) {
        const narrow = frame.cssWidth < NARROW_WINDOW_PIXELS
        const pointerTurn = frame.pointerSeen ? frame.pointer.x * 7 : 0
        const pointerTip = frame.pointerSeen ? -frame.pointer.y * 4 : 0
        const azimuth = shot.azimuth + (Math.sin(frame.seconds * 0.32) * 7 + pointerTurn) * shot.sway
        const elevation = shot.elevation + (Math.sin(frame.seconds * 0.21) * 2 + pointerTip) * shot.sway
        viewer.fov = shot.fieldOfView
        viewer.aspect = frame.width / frame.height
        target.copy(MODEL_CENTRE)
        target.z += shot.lookAhead
        target.y -= shot.lookDown
        target.lerp(cameraMount.localToWorld(controlsInView.copy(TOP_CONTROLS)), shot.onControls)
        target.lerp(chair.rig.root.getWorldPosition(chairSeat).setY(floorY + chair.rig.size.y * 0.52), shot.onChair)
        target.lerp(cameraMount.localToWorld(lensFrontInView.copy(lensFront)), aimedAtLens)
        // Square on to the lens, the viewer stands where the rim spans the same share of the window on any screen.
        const rimShare = Math.min(
            RIM_SHARE_OF_HALF_HEIGHT,
            (narrow ? RIM_SHARE_OF_HALF_WIDTH.narrow : RIM_SHARE_OF_HALF_WIDTH.wide) * viewer.aspect
        )
        const squareOn =
            (rimRadius * shot.cameraScale) / (Math.tan(MathUtils.degToRad(shot.fieldOfView / 2)) * rimShare)
        const roaming = shot.distance * (narrow ? NARROW_DISTANCE_FACTOR : Math.max(1, 1.5 / viewer.aspect))
        const distance = mix(roaming, squareOn, shot.onLens)
        viewer.near = Math.max(10, distance * 0.08)
        viewer.far = distance * 2.5 + 30000
        placeCamera(viewer, target, distance, azimuth, elevation)
        if (shot.onScreen > 0) faceTheScreen(distance)
        const shiftRight = (narrow ? 0 : shot.shiftRight) * (1 - shot.onScreen)
        const shiftDown = mix(
            mix(narrow ? NARROW_SHIFT_DOWN : shot.shiftDown, SCREEN_SHIFT_DOWN, shot.onScreen),
            0,
            shot.onLens
        )
        viewer.setViewOffset(
            frame.width,
            frame.height,
            -shiftRight * frame.width,
            -shiftDown * frame.height,
            frame.width,
            frame.height
        )
        viewer.updateProjectionMatrix()
        viewer.updateMatrixWorld()
    }

    /**
     * Stands the laptop where the shot has it: beside the camera, on its way to the crate, or on
     * it. On the crate it is one of the set's things and comes and goes with them; until then it
     * is drawn on its own, so it can come up through its dust while the camera stays as it is.
     */
    function poseTheLaptop() {
        const settled = smooth(shot.laptopOnSet)
        laptop.visible = shot.laptop > 0.01
        laptop.position.copy(LAPTOP_BY_CAMERA.position).lerp(laptopOnCrate, settled)
        laptop.rotation.y = mix(LAPTOP_BY_CAMERA.turnRadians, LAPTOP.turnRadians - Math.PI * 2, settled)
        laptop.scale.setScalar(Math.exp(mix(Math.log(LAPTOP_BY_CAMERA.scale), Math.log(LAPTOP.scale), settled)))
        const home = shot.laptopOnSet > 0.999 ? gearScene : laptopScene
        if (laptop.parent !== home) home.add(laptop)
        laptop.updateMatrixWorld(true)
    }

    /** Aims the particles of the call in flight: from the middle of the laptop's screen to the part of the camera it sets. */
    function aimTheStream(frame: Frame) {
        const { uniforms } = stream.material
        uniforms.uOpacity.value = between(shot.driven, 0.6, 1) * (1 - between(shot.laptopOnSet, 0, 0.2))
        uniforms.uTime.value = frame.seconds
        uniforms.uSize.value = DUST_SPRITE_PIXELS * (frame.width / frame.cssWidth)
        stream.points.visible = (uniforms.uOpacity.value as number) > 0.004
        if (!stream.points.visible) return
        ;(uniforms.uFrom.value as Vector3).copy(screen.centre).applyMatrix4(laptop.matrixWorld)
        cameraMount.localToWorld(
            (uniforms.uTo.value as Vector3).copy(streamTo === 'capture' ? topOf(pieceOf('reg4')) : anchors[streamTo]())
        )
    }

    /** Swings the viewer from where it stands towards square on to the laptop's screen, by as much as the shot asks. */
    function faceTheScreen(roamingDistance: number) {
        laptop.updateWorldMatrix(true, false)
        const centre = screenCentre.copy(screen.centre).applyMatrix4(laptop.matrixWorld)
        const outwards = screenOutwards.copy(screen.normal).transformDirection(laptop.matrixWorld)
        const halfHeight = (screen.height * laptop.scale.x) / 2
        const halfWindow = Math.tan(MathUtils.degToRad(viewer.fov / 2)) * SCREEN_SHARE_OF_WINDOW
        const squareOn = Math.max(
            halfHeight / halfWindow,
            (halfHeight * screen.widthOverHeight) / (halfWindow * viewer.aspect)
        )
        const from = viewerFrom.copy(viewer.position).sub(target).normalize()
        const distance = Math.exp(mix(Math.log(roamingDistance), Math.log(squareOn), shot.onScreen))
        target.lerp(centre, shot.onScreen)
        viewer.position.copy(target).addScaledVector(from.lerp(outwards, shot.onScreen).normalize(), distance)
        viewer.near = Math.max(10, distance * 0.08)
        viewer.lookAt(target)
    }

    /** Tells the page where the glass of the camera's monitor is on the canvas, so the errors of the menus chapter can be laid over it. */
    function placeTheMonitor(frame: Frame) {
        const strength = between(shot.busy, 0.45, 0.9)
        const corners =
            strength > 0
                ? monitor.corners.flatMap(corner => {
                      projected.copy(corner).applyMatrix4(monitor.part.group.matrix)
                      cameraMount.localToWorld(projected).project(viewer)
                      return [((projected.x + 1) / 2) * frame.cssWidth, ((1 - projected.y) / 2) * frame.cssHeight]
                  })
                : []
        page.placeMonitor(corners, monitor.widthOverHeight, strength)
    }

    /** Tells the page where the laptop's screen is on the canvas, so what runs on it can be laid over it. */
    function placeTheScreen(frame: Frame, drawn: number) {
        laptop.updateWorldMatrix(true, false)
        const corners = screen.corners.flatMap(corner => {
            projected.copy(corner).applyMatrix4(laptop.matrixWorld).project(viewer)
            return [((projected.x + 1) / 2) * frame.cssWidth, ((1 - projected.y) / 2) * frame.cssHeight]
        })
        const link = between(shot.laptop, LAPTOP_ARRIVES.drawnFrom, 1) * (1 - between(shot.laptopOnSet, 0, 0.2))
        page.placeScreen(corners, screen.widthOverHeight, { link, cut: between(shot.onScreen, 0.25, 0.7) * drawn })
    }

    function lightTheLook(frame: Frame) {
        flash = approach(flash, 0, 7, frame.deltaSeconds)
        ink.ink.opacity = shot.lines
        ink.glassFill.uniforms.uRimStrength.value = 0.55 + shot.glassGlow * 0.9 + flash * 2.5
        ;(ink.glassFill.uniforms.uLight.value as Color)
            .copy(restingGlassLight)
            .lerp(glowingGlassLight, Math.min(1, shot.glassGlow + flash))
        ink.fill.uniforms.uRimStrength.value = 0.1 + flash * 0.5
        record.fill.uniforms.uRimStrength.value = ink.fill.uniforms.uRimStrength.value
        const red = shot.onControls
        ;(record.fill.uniforms.uShadow.value as Color).copy(recordAtRest.shadow).lerp(RECORD_RED.shadow, red)
        ;(record.fill.uniforms.uLight.value as Color).copy(recordAtRest.light).lerp(RECORD_RED.light, red)
        ;(record.hull.uniforms.uColour.value as Color).copy(recordAtRest.line).lerp(RECORD_RED.line, red)
        record.ink.color.copy(recordAtRest.line).lerp(RECORD_RED.line, red)
        record.ink.opacity = mix(shot.lines, RECORD_RED.lineOpacity, red)
        backdrop.update(frame, shot)
        // The shutter firing throws more light for a moment.
        glow.strengthen(1 + flash * 1.5)
    }

    const pieceOf = (group: string) => rig.pieces.find(rigPiece => rigPiece.piece.group === group)!
    /** A point on the outside of a lens ring, `degrees` round from the grip side. */
    function anchorOnRing(ring: RigPiece, degrees: number): Vector3 {
        const radius = (ring.piece.bounds.max.x - ring.piece.bounds.min.x) / 2
        const angle = MathUtils.degToRad(degrees)
        return scratchVector.set(
            LENS_AXIS.x + Math.cos(angle) * radius,
            LENS_AXIS.y + Math.sin(angle) * radius,
            ring.piece.centre.z
        )
    }
    const topOf = (dial: RigPiece) => scratchVector.copy(dial.piece.centre).setY(dial.piece.bounds.max.y)
    const anchors: Record<Callout, () => Vector3> = {
        aperture: () => anchorOnRing(pieceOf('lens_ring3'), 118),
        focus: () => anchorOnRing(pieceOf('lens_ring1'), 72),
        shutter: () => topOf(pieceOf('reg2')),
        iso: () => topOf(pieceOf('reg3')),
    }

    function placeTheCallouts(frame: Frame) {
        const strength = between(shot.driven, 0.75, 1)
        for (const callout of CALLOUTS) {
            projected.copy(anchors[callout]())
            cameraMount.localToWorld(projected).project(viewer)
            page.placeCallout(
                callout,
                ((projected.x + 1) / 2) * frame.cssWidth,
                ((1 - projected.y) / 2) * frame.cssHeight,
                strength
            )
        }
    }

    /** Blends the two shots either side of `chapter` into `shot`. */
    function takeTheShot() {
        const index = Math.min(CHAPTERS.length - 1, Math.floor(chapter))
        const from = SHOTS[CHAPTERS[index]]
        const to = SHOTS[CHAPTERS[Math.min(CHAPTERS.length - 1, index + 1)]]
        const amount = chapter - index
        for (const key of SHOT_KEYS) shot[key] = mix(from[key], to[key], amount)
        // A dolly covers the same share of its distance each moment, so pulling back to the studio does not rush its start.
        shot.distance = Math.exp(mix(Math.log(from.distance), Math.log(to.distance), amount))
        // Leaving for the lens, the view swings to it at once but only comes to the middle and up close once the words beside it have gone.
        aimedAtLens = shot.onLens
        if (to.onLens <= from.onLens) return
        const closing = between(amount, CLOSING_IN_FROM, 1)
        for (const key of ARRIVING_LATE) shot[key] = mix(from[key], to[key], closing)
        shot.distance = Math.exp(mix(Math.log(from.distance), Math.log(to.distance), closing))
    }

    function poseTheDust(frame: Frame) {
        const size = DUST_SPRITE_PIXELS * (frame.width / frame.cssWidth)
        const gear = gearDust.material.uniforms
        gear.uOpacity.value =
            between(shot.gear, GEAR.dustFrom, GEAR.dustBy) * (1 - between(shot.gear, GEAR.dustGoneFrom, 1)) * shot.ink
        gear.uScatter.value = 1 - between(shot.gear, GEAR.settlesFrom, GEAR.settlesBy)
        gear.uTime.value = frame.seconds
        gear.uSize.value = size
        gearDust.points.visible = (gear.uOpacity.value as number) > 0.004

        const arriving = laptopDust.material.uniforms
        arriving.uOpacity.value =
            between(shot.laptop, LAPTOP_ARRIVES.dustFrom, LAPTOP_ARRIVES.dustBy) *
            (1 - between(shot.laptop, LAPTOP_ARRIVES.dustGoneFrom, 1)) *
            shot.ink
        arriving.uScatter.value = 1 - between(shot.laptop, LAPTOP_ARRIVES.settlesFrom, LAPTOP_ARRIVES.settlesBy)
        arriving.uTime.value = frame.seconds
        arriving.uSize.value = size
        laptopDust.points.position.copy(laptop.position)
        laptopDust.points.rotation.copy(laptop.rotation)
        laptopDust.points.scale.copy(laptop.scale)
        laptopDust.points.visible = (arriving.uOpacity.value as number) > 0.004

        const ring = ringDust.material.uniforms
        const wave = MathUtils.clamp((shot.swept - DISSOLVE.waveFrom) / (DISSOLVE.waveBy - DISSOLVE.waveFrom), 0, 1)
        ring.uOpacity.value = between(shot.swept, 0, DISSOLVE.dustBy)
        ring.uWave.value = mix(
            cameraDepth.back - WAVE_MARGIN_MILLIMETRES,
            cameraDepth.front + WAVE_MARGIN_MILLIMETRES,
            wave
        )
        ring.uRingIn.value = between(shot.swept, DISSOLVE.ringFrom, 1)
        ring.uDream.value = smooth(shot.ring)
        ring.uTime.value = frame.seconds
        ring.uSize.value = size
        ring.uRingRadius.value = rimRadius
        // The dust is the camera's, so it stands where the camera does and at its size.
        ringDust.points.position.copy(cameraMount.position)
        ringDust.points.scale.copy(cameraMount.scale)
        const [right, up] = [ring.uRingRight.value as Vector3, ring.uRingUp.value as Vector3]
        ;(ring.uRingCentre.value as Vector3).copy(lensFront)
        right.setFromMatrixColumn(viewer.matrixWorld, 0)
        up.setFromMatrixColumn(viewer.matrixWorld, 1)
        ringDust.points.visible = (ring.uOpacity.value as number) > 0.004
        if (!ringDust.points.visible) return

        // Where the pointer meets the plane the ring lies in is where the dust is stirred.
        ringPlane.setFromNormalAndCoplanarPoint(
            scratchVector.crossVectors(right, up),
            cameraMount.localToWorld(lensFrontInView.copy(lensFront))
        )
        raycaster.setFromCamera(pointerInView.set(frame.pointer.x, -frame.pointer.y), viewer)
        const meets = frame.pointerSeen && raycaster.ray.intersectPlane(ringPlane, stirAt) !== null
        if (meets) cameraMount.worldToLocal(stirAt)
        stirStrength = approach(stirStrength, meets ? 1 : 0, 4, frame.deltaSeconds)
        ;(ring.uStir.value as Vector4).set(stirAt.x, stirAt.y, stirAt.z, stirStrength)
    }

    return {
        draw(frame, renderer) {
            chapter = MathUtils.clamp(
                approach(chapter, chapterAt(page.sections), frame.still ? 60 : 4.5, frame.deltaSeconds),
                0,
                CHAPTERS.length - 1
            )
            takeTheShot()
            page.showChapter(chapter)
            const cameraDrawn = shot.ink * (1 - between(shot.swept, DISSOLVE.drawingGoneFrom, DISSOLVE.drawingGoneBy))
            const gearDrawn = shot.ink * between(shot.gear, GEAR.drawnFrom, GEAR.drawnBy)
            const laptopDrawn = between(shot.laptop, LAPTOP_ARRIVES.drawnFrom, LAPTOP_ARRIVES.drawnBy)
            poseTheLaptop()
            poseTheCamera(frame)
            placeTheViewer(frame)
            aimTheStream(frame)
            poseTheStudio(frame, gearDrawn)
            lightTheLook(frame)
            placeTheCallouts(frame)
            poseTheDust(frame)
            placeTheScreen(frame, gearDrawn)
            placeTheMonitor(frame)
            // The cut assembles as its sheet passes through the window, not as the viewer arrives at the screen.
            const cutBounds = cutSection.getBoundingClientRect()
            const through = (innerHeight / 2 - cutBounds.top) / cutBounds.height
            page.showState({
                cut: between(through, CUT_ASSEMBLES.from, CUT_ASSEMBLES.by),
                rolling: shot.rolling * between(shot.gear, GEAR.drawnFrom, GEAR.drawnBy),
                // The chair and the close-up of the controls both fill the window, words and all.
                wordsOverPicture: Math.max(shot.onChair, shot.onControls),
            })

            // The gear is drawn first and veiled to its share of the camera's strength; the camera goes over it, and one veil then dims the two together.
            renderer.autoClear = false
            renderer.clear()
            if (gearDrawn > 0.004 && cameraDrawn > 0.004) {
                renderer.render(gearScene, viewer)
                veil(renderer, Math.min(1, gearDrawn / cameraDrawn))
            }
            // Until it is on the set the laptop is drawn on its own and veiled to how far it has arrived. That veil falls on the gear too, which is never drawn while the laptop is still arriving.
            if (laptop.parent === laptopScene && laptopDrawn > 0.004 && cameraDrawn > 0.004) {
                renderer.render(laptopScene, viewer)
                veil(renderer, laptopDrawn)
            }
            if (cameraDrawn > 0.004) {
                renderer.render(cameraScene, viewer)
                veil(renderer, cameraDrawn)
            }
            if (
                gearDust.points.visible ||
                ringDust.points.visible ||
                stream.points.visible ||
                laptopDust.points.visible
            )
                renderer.render(dustScene, viewer)
            // The backdrop goes under everything drawn so far, and the light that spills from the gold over all of it.
            renderer.render(backdrop.scene, backdrop.camera)
            glow.over(renderer, frame)
        },
        dispose() {
            backdrop.dispose()
            glow.dispose()
        },
    }

    /** Keeps `keep` of everything drawn so far, colour and coverage alike. */
    function veil(renderer: WebGLRenderer, keep: number) {
        if (keep >= 0.996) return
        fade.material.uniforms.uKeep.value = keep
        renderer.render(fade.scene, fade.camera)
    }
}
