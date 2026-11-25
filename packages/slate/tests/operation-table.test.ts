import { Camera } from '@camera/index'
import {
    allOperations,
    cameraOperationTable,
    cameraStaticOperationTable,
    cliCommand,
    mcpToolName,
    plannedOperationTable,
    publicOperations,
} from '@camera/operation-table/index'
import { settingGetterName, settingSetterName, typedSettingIds } from '@camera/settings/typed-settings'
import { describe, expect, it } from 'vitest'

const prototypeMethods = Object.getOwnPropertyNames(Camera.prototype).filter(name => name !== 'constructor')

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

describe('operation table parity', () => {
    it('has exactly one entry per Camera method, in both directions', () => {
        expect(prototypeMethods.filter(name => !(name in cameraOperationTable))).toEqual([])
        expect(Object.keys(cameraOperationTable).filter(name => !prototypeMethods.includes(name))).toEqual([])
        expect(Object.keys(cameraStaticOperationTable)).toEqual(['discover'])
        expect(typeof Camera.discover).toBe('function')
    })

    it('keeps planned operations off Camera until they land', () => {
        expect(Object.keys(plannedOperationTable).filter(name => prototypeMethods.includes(name))).toEqual([])
    })

    it('records every current method with a disposition from the plan', () => {
        expect(Object.keys(cameraOperationTable).length).toBe(prototypeMethods.length)
        for (const [name, entry] of allOperations()) {
            if (entry.disposition.kind === 'replaced-by' || entry.disposition.kind === 'rename-to')
                expect(publicOperations().map(operation => operation.name), `${name} → ${entry.disposition.target}`).toContain(
                    entry.disposition.target
                )
            if (['keep', 'add'].includes(entry.disposition.kind)) expect(entry.summary, name).toBeTruthy()
        }
    })

    it("derives the plan's public API: 27 methods plus a typed pair for each of 29 settings", () => {
        const publicNames = publicOperations().map(operation => operation.name)
        const settingMethods: string[] = planSettings.flatMap(id => [settingGetterName(id), settingSetterName(id)])
        expect(publicNames.filter(name => !settingMethods.includes(name)).sort()).toEqual([...planPublicMethods].sort())
        expect(publicNames.filter(name => settingMethods.includes(name)).sort()).toEqual(settingMethods.sort())
        for (const id of typedSettingIds) expect(cameraOperationTable).toHaveProperty(settingSetterName(id))
    })

    it('derives MCP tool and CLI names mechanically, with the recorded exceptions', () => {
        expect(mcpToolName('takePhoto')).toBe('camera_take_photo')
        expect(cliCommand('takePhoto')).toBe('darkgrade camera take-photo')
        expect(mcpToolName('setShutterSpeed')).toBe('camera_set_shutter_speed')
        expect(cliCommand('setShutterSpeed')).toBe('darkgrade camera set-shutter-speed')
        expect(mcpToolName('getLiveViewFrame')).toBe('camera_get_live_view_frame')
        expect(cliCommand('discover')).toBe('darkgrade cameras')
        expect(mcpToolName('discover')).toBe('camera_discover')
        expect(cliCommand('connect')).toBeUndefined()
        expect(cliCommand('startZoom')).toBeUndefined()
        expect(mcpToolName('on')).toBeUndefined()
        const operations = publicOperations()
        const tools = operations.flatMap(operation => (operation.mcpTool ? [operation.mcpTool] : []))
        const commands = operations.flatMap(operation => (operation.cliCommand ? [operation.cliCommand] : []))
        expect(new Set(tools).size).toBe(tools.length)
        expect(new Set(commands).size).toBe(commands.length)
        expect(tools.every(tool => /^camera_[a-z0-9_]+$/.test(tool))).toBe(true)
    })
})
