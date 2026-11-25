import { Camera } from '@camera/index'
import { settingGetterName, settingSetterName } from '@camera/settings/typed-settings'
import { surfaceOperation, surfaceOperations } from '@runtime/operations'
import { describe, expect, it } from 'vitest'

/** The 27 public methods of the plan's "The API" section, besides the typed setting pairs. */
const planPublicMethods = [
    'discover', 'connect', 'disconnect', 'recover', 'getInfo',
    'getCapabilities', 'setControl',
    'autofocus', 'setFocusPoint', 'resetFocusPoint', 'nudgeFocus',
    'zoomTo', 'startZoom', 'stopZoom',
    'takePhoto', 'getLiveViewFrame',
    'startRecording', 'stopRecording', 'getRecordingState',
    'getCardStatus', 'listMedia', 'getMediaPreview', 'downloadMedia',
    'getBattery', 'setClock',
    'on', 'off',
]

/** The plan's 29 settings, each with a typed getter and setter. */
const planSettings = [
    'shutterSpeed', 'aperture', 'iso', 'exposureMode', 'exposureCompensation', 'meteringMode',
    'photoVideoMode', 'driveMode',
    'whiteBalance', 'colorTemperature', 'pictureStyle', 'pictureProfile',
    'focusMode', 'focusArea', 'subjectDetection', 'detectionSubject', 'eyeSelection',
    'photoFormat', 'photoSize', 'aspectRatio', 'jpegQuality', 'rawCompression', 'flashMode',
    'videoFormat', 'videoQuality', 'frameRate', 'audioRecording', 'digitalZoom',
    'liveViewQuality',
]

describe('generated camera operations', () => {
    const names = surfaceOperations().map(operation => operation.name)

    it("covers the plan's public API: every method but the events, plus a typed pair for each of 29 settings", () => {
        const settingMethods: string[] = planSettings.flatMap(id => [settingGetterName(id), settingSetterName(id)])
        const libraryOnly = ['on', 'off']
        expect(names.filter(name => !settingMethods.includes(name)).sort()).toEqual(
            planPublicMethods.filter(name => !libraryOnly.includes(name)).sort()
        )
        expect(names.filter(name => settingMethods.includes(name)).sort()).toEqual(settingMethods.sort())
        const prototypeMethods = Object.getOwnPropertyNames(Camera.prototype).filter(name => !['constructor', ...libraryOnly].includes(name))
        expect(prototypeMethods.filter(name => !names.includes(name))).toEqual([])
    })

    it("reads inputs from Camera's signatures and summaries from its doc comments", () => {
        expect(surfaceOperation('setFocusPoint')?.parameters).toEqual([
            expect.objectContaining({ name: 'x', type: 'number', required: true, argument: 0 }),
            expect.objectContaining({ name: 'y', type: 'number', required: true, argument: 1 }),
            expect.objectContaining({ name: 'autofocus', type: 'switch', argument: 2, property: 'autofocus' }),
        ])
        expect(surfaceOperation('takePhoto')?.parameters.find(parameter => parameter.name === 'destination')?.choices).toEqual([
            'card',
            'computer',
        ])
        expect(surfaceOperation('setColorTemperature')?.parameters).toEqual([expect.objectContaining({ type: 'number', required: true })])
        expect(surfaceOperation('stopRecording')?.summary).toMatch(/^Stops, waits until a finished clip is on the card/)
        expect(surfaceOperation('getIso')?.summary).toBe('The current ISO')
    })

    it('derives MCP tool and CLI names mechanically, with discover as darkgrade cameras', () => {
        expect(surfaceOperation('takePhoto')).toMatchObject({ mcpTool: 'camera_take_photo', cliCommand: 'darkgrade camera take-photo' })
        expect(surfaceOperation('setShutterSpeed')?.mcpTool).toBe('camera_set_shutter_speed')
        expect(surfaceOperation('getLiveViewFrame')?.cliCommand).toBe('darkgrade camera get-live-view-frame')
        expect(surfaceOperation('discover')).toMatchObject({ static: true, mcpTool: 'camera_discover', cliCommand: 'darkgrade cameras' })
        expect(surfaceOperation('on')).toBeUndefined()
        const tools = surfaceOperations().map(operation => operation.mcpTool)
        expect(new Set(tools).size).toBe(tools.length)
        expect(tools.every(tool => /^camera_[a-z0-9_]+$/.test(tool))).toBe(true)
    })
})
