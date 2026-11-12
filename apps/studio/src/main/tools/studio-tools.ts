import { cameraService } from '@main/camera-service'
import { studioView } from '@main/studio-view'
import { apertureToNumber, isoToNumber, shutterToNumber } from '@shared/exposure-stops'
import { exposureVerdict } from '@shared/exposure-verdict'
import { analyseFrame } from '@shared/frame-analysis'
import {
    CAMERA_CONTROL_LABELS,
    CAMERA_CONTROL_NAMES,
    SCOPE_IDS,
    type CameraControl,
    type CameraControlName,
} from '@shared/ipc'
import { matchOption } from '@shared/setting-values'
import { SHOOTING_GUIDANCE } from '@shared/shooting-guidance'
import { nativeImage } from 'electron'
import * as z from 'zod/v4'

/** What a tool returns: JSON for the model to read, and optionally a picture for one that can see. */
export interface ToolResult {
    data: unknown
    image?: { base64: string; mimeType: 'image/jpeg' }
}

export interface StudioTool {
    name: string
    title: string
    description: string
    inputSchema: z.ZodObject
    /** Changes the camera or files (as opposed to only reading). Clients may ask before running these. */
    changesSomething: boolean
    run(input: Record<string, unknown>): Promise<ToolResult>
}

/** Width frames are measured at: plenty for statistics, cheap to compute. */
const ANALYSIS_WIDTH = 320
/** Width of the frame handed to a model that can see. */
const VISION_WIDTH = 768
const ZOOM_MAXIMUM_MS = 5000

type SettingName = CameraControlName

/** Every setting the connected camera reports right now, with its value, choices and whether it can change. */
function availableSettings(): Partial<Record<SettingName, CameraControl>> {
    const state = cameraService.getState()
    const settings: Partial<Record<SettingName, CameraControl>> = {}
    for (const name of CAMERA_CONTROL_NAMES) {
        const control = state.controls?.[name]
        if (control) settings[name] = control
    }
    const fallbacks: [SettingName, string | null][] = [
        ['iso', state.settings.iso],
        ['shutterSpeed', state.settings.shutterSpeed],
        ['aperture', state.settings.aperture],
    ]
    for (const [name, value] of fallbacks) {
        if (!settings[name] && value !== null) settings[name] = { value, options: [], enabled: true }
    }
    return settings
}

function requireConnected(): void {
    if (!cameraService.getState().connected) throw new Error('No camera is connected')
}

/** One setting change, kept so a later "undo that" can put it back. */
interface SettingChange {
    setting: SettingName
    from: string | null
    to: string
    /** Changes made for one request share a group; undo reverts a whole group. */
    group: number
}

const MAXIMUM_REMEMBERED_CHANGES = 50
const changeHistory: SettingChange[] = []
let currentGroup = 0
let groupHeldByCaller = false

/**
 * Starts a new group of changes for one request (the assistant calls this per spoken request), so
 * undo reverts everything that request changed. Without it, every tool call is its own group.
 */
export function beginChangeGroup(): void {
    currentGroup++
    groupHeldByCaller = true
}

export function endChangeGroup(): void {
    groupHeldByCaller = false
}

function recordChange(change: Omit<SettingChange, 'group'>): void {
    if (!groupHeldByCaller) currentGroup++
    changeHistory.push({ ...change, group: currentGroup })
    if (changeHistory.length > MAXIMUM_REMEMBERED_CHANGES) changeHistory.shift()
}

/** "Movie mode" and "photo mode" keep the exposure type: Manual ↔ Movie Manual, Aperture Priority ↔ Movie Aperture Priority. */
function counterpartMode(requested: string, current: string | null, options: string[]): string | null {
    const wantsMovie = /^(movie|video|film)( mode)?$/i.test(requested.trim())
    const wantsPhoto = /^(photo|still|stills|picture)( mode)?$/i.test(requested.trim())
    if (!wantsMovie && !wantsPhoto) return null
    const base = (current ?? '').replace(/^(movie|s&q)\s+/i, '')
    const target = wantsMovie ? `movie ${base}` : base
    return (
        options.find(option => option.toLowerCase() === target.toLowerCase()) ??
        options.find(option => (wantsMovie ? /^movie/i.test(option) : !/^(movie|s&q)/i.test(option))) ??
        null
    )
}

async function applySetting(name: SettingName, value: string): Promise<string> {
    const control = availableSettings()[name]
    if (!control) throw new Error(`${CAMERA_CONTROL_LABELS[name]} isn't available on this camera right now`)
    if (!control.enabled)
        throw new Error(`${CAMERA_CONTROL_LABELS[name]} can't be changed in the camera's current mode`)
    const modeSwitch = name === 'exposureProgram' ? counterpartMode(value, control.value, control.options) : null
    const chosen = modeSwitch ?? (control.options.length ? matchOption(name, value, control.options) : value)
    if (!chosen) {
        throw new Error(
            `${CAMERA_CONTROL_LABELS[name]} has no value "${value}". Choices: ${control.options.join(', ')}`
        )
    }
    if (cameraService.getState().controls?.[name]) await cameraService.setControl(name, chosen)
    else if (name === 'iso') await cameraService.setIso(chosen)
    else if (name === 'shutterSpeed') await cameraService.setShutterSpeed(chosen)
    else if (name === 'aperture') await cameraService.setAperture(chosen)
    else throw new Error(`${CAMERA_CONTROL_LABELS[name]} can't be set on this camera`)
    if (chosen !== control.value) recordChange({ setting: name, from: control.value, to: chosen })
    return chosen
}

async function undoLastChange(): Promise<unknown> {
    const last = changeHistory.at(-1)
    if (!last) throw new Error('Nothing to undo: no settings have been changed yet')
    const group = changeHistory.filter(change => change.group === last.group)
    const restored: { setting: string; to: string }[] = []
    groupHeldByCaller = true // restoring isn't itself a new undoable change
    try {
        for (const change of [...group].reverse()) {
            if (change.from === null) continue
            await applySetting(change.setting, change.from)
            restored.push({ setting: change.setting, to: change.from })
        }
    } finally {
        groupHeldByCaller = false
    }
    changeHistory.splice(changeHistory.length - group.length - restored.length)
    return { restored }
}

async function adjustColorTemperature(kelvin: number): Promise<unknown> {
    const settings = availableSettings()
    const temperature = settings.colorTemperature
    if (!temperature) throw new Error("This camera doesn't offer a colour temperature setting right now")
    const changes: unknown[] = []
    if (!temperature.enabled && settings.whiteBalance) {
        const kelvinMode = settings.whiteBalance.options.find(option => /temp|kelvin/i.test(option))
        if (!kelvinMode) throw new Error('White balance has no colour temperature mode to switch to')
        changes.push({ whiteBalance: await applySetting('whiteBalance', kelvinMode) })
    }
    const current = Number.parseFloat(availableSettings().colorTemperature?.value ?? '') || 5600
    const target = Math.round((current + kelvin) / 100) * 100
    const applied = await applySetting('colorTemperature', String(target))
    changes.push({ colorTemperature: { from: current, to: applied } })
    return { changes }
}

/** Brighter is positive. ISO and aperture-number scale differently from light: this maps each to stops. */
const EXPOSURE_SETTINGS: {
    name: 'iso' | 'shutterSpeed' | 'aperture'
    read: (value: string) => number | null
    stopsPerDoubling: number
}[] = [
    { name: 'iso', read: isoToNumber, stopsPerDoubling: 1 },
    { name: 'shutterSpeed', read: shutterToNumber, stopsPerDoubling: 1 },
    // f-numbers scale with the square root of light: f/2.8 → f/4 is one stop darker.
    { name: 'aperture', read: apertureToNumber, stopsPerDoubling: -2 },
]

/** The option closest to `stops` brighter than the current value, or null when it can't move. */
function stepByStops(
    control: CameraControl,
    read: (value: string) => number | null,
    stops: number,
    stopsPerDoubling: number
): string | null {
    const current = control.value ? read(control.value) : null
    if (!current) return null
    const target = current * 2 ** (stops / stopsPerDoubling)
    let best: string | null = null
    let bestDistance = Infinity
    for (const option of control.options) {
        const candidate = read(option)
        if (!candidate) continue
        const distance = Math.abs(Math.log(candidate / target))
        if (distance < bestDistance) {
            best = option
            bestDistance = distance
        }
    }
    return best && best !== control.value ? best : null
}

function isMovieMode(): boolean {
    return /movie|video|s&q/i.test(cameraService.getState().controls?.exposureProgram?.value ?? '')
}

async function adjustExposure(stops: number, using: string): Promise<unknown> {
    const settings = availableSettings()
    const preferred =
        using !== 'auto'
            ? [using]
            : isMovieMode()
              ? ['iso', 'aperture', 'shutterSpeed'] // keep the 180° shutter in video
              : ['iso', 'shutterSpeed', 'aperture']
    const reasons: string[] = []
    for (const name of preferred) {
        const definition = EXPOSURE_SETTINGS.find(setting => setting.name === name)
        const control = definition && settings[definition.name]
        if (!definition || !control) {
            reasons.push(`${name}: not available`)
            continue
        }
        if (!control.enabled) {
            reasons.push(`${name}: locked in the current mode`)
            continue
        }
        const next = stepByStops(control, definition.read, stops, definition.stopsPerDoubling)
        if (!next) {
            reasons.push(`${name}: already at its limit or set to auto (${control.value})`)
            continue
        }
        const from = control.value
        const applied = await applySetting(definition.name, next)
        return { changed: CAMERA_CONTROL_LABELS[definition.name], from, to: applied, requestedStops: stops }
    }
    throw new Error(`Couldn't change exposure: ${reasons.join('; ')}`)
}

function decodedFrame(width: number) {
    const jpeg = cameraService.latestLiveViewFrame
    if (!jpeg || !cameraService.getState().liveView)
        throw new Error('Live view is off, so there is no picture to look at')
    const image = nativeImage.createFromBuffer(Buffer.from(jpeg))
    const size = image.getSize()
    return size.width > width ? image.resize({ width, quality: 'good' }) : image
}

/** Lists short choice lists in full and long ones (ISO, shutter, aperture) as their range, so status stays small. */
const CHOICES_LISTED_IN_FULL = 16

function summariseChoices(options: string[]): string | string[] {
    if (options.length <= CHOICES_LISTED_IN_FULL) return options
    return `${options[0]} … ${options.at(-1)} (${options.length} values)`
}

/** The camera's current state in few tokens: what a model needs to choose and phrase a change. */
export function cameraStatus(): unknown {
    const state = cameraService.getState()
    if (!state.connected) return { connected: false, phase: state.phase }
    const settings = Object.fromEntries(
        Object.entries(availableSettings()).map(([name, control]) => [
            name,
            {
                value: control.value,
                ...(control.options.length ? { choices: summariseChoices(control.options) } : {}),
                ...(control.enabled ? {} : { locked: true }),
            },
        ])
    )
    return {
        connected: true,
        camera: state.model ?? state.vendor,
        liveView: state.liveView,
        recording: state.recording,
        mode: isMovieMode() ? 'movie' : 'photo',
        lens: state.lens,
        batteryPercent: state.battery?.percent ?? null,
        card: {
            photosLeft: state.card?.remainingPhotos ?? null,
            videoSecondsLeft: state.card?.remainingVideoSeconds ?? null,
        },
        settings,
        studioView: studioView.getState(),
    }
}

const SETTING_NAMES = z.enum(CAMERA_CONTROL_NAMES)

/** Every tool Studio offers, to MCP clients and to its own assistant. All of them are camera-agnostic. */
export const STUDIO_TOOLS: StudioTool[] = [
    {
        name: 'get_camera_status',
        title: 'Camera status',
        description:
            'The connected camera and everything it reports right now: model, lens, battery, card space, whether live view and recording are on, photo or movie mode, and every setting with its current value, the values it currently accepts, and whether it can be changed in the current mode. Read this before changing settings.',
        inputSchema: z.object({}),
        changesSomething: false,
        run: async () => ({ data: cameraStatus() }),
    },
    {
        name: 'set_setting',
        title: 'Change a setting',
        description: `Set one camera setting to a value it accepts (see get_camera_status for choices). Values are matched loosely: "f/8", "1/50", "800" and "auto" all work. Settings: ${CAMERA_CONTROL_NAMES.map(name => `${name} (${CAMERA_CONTROL_LABELS[name]})`).join(', ')}.`,
        inputSchema: z.object({
            setting: SETTING_NAMES,
            value: z.string().describe('The new value, e.g. "F8.0", "1/50", "ISO 800", "5600"'),
        }),
        changesSomething: true,
        run: async input => {
            requireConnected()
            const setting = input.setting as SettingName
            const before = availableSettings()[setting]?.value ?? null
            const applied = await applySetting(setting, String(input.value))
            return { data: { setting, from: before, to: applied } }
        },
    },
    {
        name: 'adjust_exposure',
        title: 'Brighter or darker',
        description:
            'Make the picture brighter (positive stops) or darker (negative stops) by changing the right setting: in movie mode ISO then aperture, keeping the shutter at its 180° value; in photo mode ISO, then shutter, then aperture. "A bit" is about 0.3–0.7 stops. Use analyze_frame first when the user describes how it looks.',
        inputSchema: z.object({
            stops: z.number().min(-5).max(5).describe('Positive is brighter, negative darker; thirds like 0.33 work'),
            using: z
                .enum(['auto', 'iso', 'shutterSpeed', 'aperture'])
                .default('auto')
                .describe('Which setting to move; auto picks by the rules above'),
        }),
        changesSomething: true,
        run: async input => {
            requireConnected()
            return { data: await adjustExposure(Number(input.stops), String(input.using ?? 'auto')) }
        },
    },
    {
        name: 'adjust_color_temperature',
        title: 'Warmer or cooler',
        description:
            'Make the picture warmer (positive kelvin, more orange) or cooler (negative, bluer) from the current colour temperature, switching white balance to a Kelvin mode if needed. "A touch" is about 200–300 K, "a bit" 300–500 K, "a lot" 1000 K. Use this for any warmer/cooler/too blue/too orange request.',
        inputSchema: z.object({ kelvin: z.number().min(-3000).max(3000).describe('Positive is warmer') }),
        changesSomething: true,
        run: async input => {
            requireConnected()
            return { data: await adjustColorTemperature(Number(input.kelvin)) }
        },
    },
    {
        name: 'undo_last_change',
        title: 'Undo',
        description:
            'Put back the settings changed by the most recent request (every setting it changed), e.g. for "undo that" or "go back to how it was".',
        inputSchema: z.object({}),
        changesSomething: true,
        run: async () => {
            requireConnected()
            return { data: await undoLastChange() }
        },
    },
    {
        name: 'analyze_frame',
        title: 'Measure the picture',
        description:
            'Measure the current live-view picture like the scopes: histogram (mean brightness, percentiles, clipped highlights, crushed shadows, highlight headroom in stops for exposing to the right), waveform by thirds of the frame, vectorscope (colour cast, saturation) and a sharpness reading. Use it to judge exposure, colour and focus before recommending or making changes. exposure.verdict and exposure.suggestedStops say whether the picture is too dark or too bright and the adjust_exposure step that fixes it: apply that step only when asked to fix or change the exposure; for a question, just report the verdict.',
        inputSchema: z.object({}),
        changesSomething: false,
        run: async () => {
            const image = decodedFrame(ANALYSIS_WIDTH)
            const size = image.getSize()
            const analysis = analyseFrame(image.toBitmap(), size.width, size.height, true)
            // The 64 bins are for drawing; a model reads the summary numbers.
            const { bins: _bins, ...histogram } = analysis.histogram
            return { data: { exposure: exposureVerdict(analysis.histogram), ...analysis, histogram } }
        },
    },
    {
        name: 'get_frame',
        title: 'See the picture',
        description:
            'The current live-view picture as an image, for a model that can see. Use for questions about framing, the subject, light or what is in the shot.',
        inputSchema: z.object({}),
        changesSomething: false,
        run: async () => {
            const image = decodedFrame(VISION_WIDTH)
            const size = image.getSize()
            return {
                data: { width: size.width, height: size.height },
                image: { base64: image.toJPEG(85).toString('base64'), mimeType: 'image/jpeg' },
            }
        },
    },
    {
        name: 'autofocus',
        title: 'Autofocus',
        description: 'Run autofocus once with the current focus area and settings.',
        inputSchema: z.object({}),
        changesSomething: true,
        run: async () => {
            requireConnected()
            return { data: { result: await cameraService.focus() } }
        },
    },
    {
        name: 'focus_at',
        title: 'Focus on a point',
        description:
            'Move the focus point to a spot in the picture and focus there. x and y are fractions of the frame from the top left (0.5, 0.5 is the centre; 0.1 is near the left or top edge, 0.9 near the right or bottom). To focus on a named thing, call get_frame first and take its position from the picture; never guess the centre.',
        inputSchema: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
        changesSomething: true,
        run: async input => {
            requireConnected()
            return { data: { result: await cameraService.focusAt(Number(input.x), Number(input.y)) } }
        },
    },
    {
        name: 'take_photo',
        title: 'Take a photo',
        description: 'Take a photo and save it to the download folder. Only when the user asks for a photo.',
        inputSchema: z.object({ autofocus: z.boolean().default(true).describe('Focus before taking it') }),
        changesSomething: true,
        run: async input => {
            requireConnected()
            const result = await cameraService.capture({ autofocus: input.autofocus !== false })
            return { data: { filename: result.filename, savedPath: result.savedPath, sizeBytes: result.sizeBytes } }
        },
    },
    {
        name: 'set_recording',
        title: 'Start or stop recording',
        description: 'Start or stop video recording. Only when the user asks.',
        inputSchema: z.object({ recording: z.boolean() }),
        changesSomething: true,
        run: async input => {
            requireConnected()
            const state = input.recording ? await cameraService.startRecording() : await cameraService.stopRecording()
            return { data: { recording: state.recording } }
        },
    },
    {
        name: 'set_live_view',
        title: 'Live view on or off',
        description: 'Turn the live-view preview on or off.',
        inputSchema: z.object({ on: z.boolean() }),
        changesSomething: true,
        run: async input => {
            requireConnected()
            const state = input.on ? await cameraService.startLiveView() : await cameraService.stopLiveView()
            return { data: { liveView: state.liveView } }
        },
    },
    {
        name: 'zoom',
        title: 'Zoom',
        description: "Zoom the lens (power zoom or the camera's digital zoom) wider or tighter for a moment.",
        inputSchema: z.object({
            direction: z.enum(['wide', 'tele']).describe('wide zooms out, tele zooms in'),
            milliseconds: z.number().min(50).max(ZOOM_MAXIMUM_MS).default(500),
        }),
        changesSomething: true,
        run: async input => {
            requireConnected()
            await cameraService.zoomStart(input.direction as 'wide' | 'tele')
            await new Promise(resolve => setTimeout(resolve, Number(input.milliseconds ?? 500)))
            await cameraService.zoomStop()
            return { data: { lens: cameraService.getState().lens } }
        },
    },
    {
        name: 'set_studio_view',
        title: 'Scopes, zebras and peaking',
        description:
            "Change what Studio shows: the scope beside the preview (histogram, waveform or vectorscope), zebra stripes over bright areas and focus peaking over sharp edges. These are Studio's own, drawn on the computer; the camera's settings are untouched. Give only what should change.",
        inputSchema: z.object({
            scope: z.enum(SCOPE_IDS).optional(),
            zebras: z.boolean().optional(),
            zebraLevelPercent: z
                .number()
                .min(70)
                .max(100)
                .optional()
                .describe('Stripes appear at or above this brightness'),
            focusPeaking: z.boolean().optional(),
            peakingSensitivity: z.number().min(1).max(100).optional().describe('Higher marks softer edges too'),
        }),
        changesSomething: true,
        run: async input => {
            const change = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
            if (Object.keys(change).length === 0) throw new Error('Nothing to change')
            return { data: { studioView: studioView.change(change) } }
        },
    },
    {
        name: 'set_camera_display_overlay',
        title: 'Camera display overlay',
        description:
            "Show or hide the camera's own on-screen display (its menus, icons and readouts) over the live view. Not for zebras, peaking or scopes: those are set_studio_view.",
        inputSchema: z.object({ on: z.boolean() }),
        changesSomething: true,
        run: async input => ({ data: { overlay: (await cameraService.setOsdOverlay(Boolean(input.on))).osdOverlay } }),
    },
    {
        name: 'list_card_files',
        title: 'Files on the card',
        description: 'List photos and videos on the camera card, newest first.',
        inputSchema: z.object({ limit: z.number().int().min(1).max(500).default(50) }),
        changesSomething: false,
        run: async input => {
            requireConnected()
            const files = await cameraService.listFiles()
            const newest = [...files].reverse().slice(0, Number(input.limit ?? 50))
            return {
                data: newest.map(file => ({
                    filename: file.filename,
                    kind: /\.(mp4|mov|mxf|avi|m4v)$/i.test(file.filename) ? 'video' : 'photo',
                    captureDate: file.captureDate,
                    sizeBytes: file.sizeBytes,
                })),
            }
        },
    },
    {
        name: 'download_files',
        title: 'Download files',
        description:
            'Copy files from the card to the download folder: by filename, or all of them. Only when the user asks.',
        inputSchema: z.object({ filenames: z.array(z.string()).optional(), all: z.boolean().default(false) }),
        changesSomething: true,
        run: async input => {
            requireConnected()
            if (input.all) return { data: { saved: await cameraService.downloadAll() } }
            const wanted = new Set((input.filenames as string[] | undefined) ?? [])
            if (wanted.size === 0) throw new Error('Name the files to download, or set all')
            const files = (await cameraService.listFiles()).filter(file => wanted.has(file.filename))
            const saved: string[] = []
            for (const file of files) saved.push(await cameraService.downloadFile(file))
            return {
                data: { saved, notFound: [...wanted].filter(name => !files.some(file => file.filename === name)) },
            }
        },
    },
    {
        name: 'get_shooting_guidance',
        title: 'Shooting guidance',
        description:
            'Rules of thumb for exposure, shutter speed, aperture, ISO, white balance and focus, and how to read the scopes.',
        inputSchema: z.object({}),
        changesSomething: false,
        run: async () => ({ data: SHOOTING_GUIDANCE }),
    },
]

export function findTool(name: string): StudioTool | undefined {
    return STUDIO_TOOLS.find(tool => tool.name === name)
}
