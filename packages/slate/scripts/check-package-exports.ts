import {execFileSync, spawnSync} from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync, realpathSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// The shared runtime's entries: each must load under Node in both formats, and the browser
// entry must leave out the Node-only lease coordinator that the default entry carries.
for(const format of ['esm','commonjs']){
    const load=(name:string)=>format==='esm'?`await import('${name}')`:`require('${name}')`
    const check=`const runtime=${load('@darkgrade/slate/runtime')},browser=${load('@darkgrade/slate/runtime/browser')},mcp=${load('@darkgrade/slate/runtime/mcp')},ownership=${load('@darkgrade/slate/runtime/ownership')};`+
        "for(const [api,names] of [[runtime,['CameraRuntime','HttpCameraClient','HardwareCoordinator','HardwareBusyError']],[browser,['CameraRuntime','HttpCameraClient']],[mcp,['createCameraMcpServer','registerCameraTools']],[ownership,['HardwareCoordinator']]])for(const name of names)if(typeof api[name]!=='function')throw new Error(name+' is missing');"+
        "if('HardwareCoordinator' in browser)throw new Error('The browser entry must not carry the Node lease coordinator');console.log('Built '+"+JSON.stringify(format)+"+' runtime exports passed')"
    execFileSync('node',[...(format==='esm'?['--input-type=module']:[]),'-e',check],{stdio:'inherit'})
}

// A packed Slate must serve diagnostics without the USB, terminal or MCP dependencies.
// The isolated directory has no workspace symlinks or installed third-party packages.
const isolated = mkdtempSync(join(tmpdir(), 'darkgrade-slate-diagnostics-'))
try {
    const packaged = join(isolated, 'node_modules/@darkgrade/slate')
    mkdirSync(packaged, { recursive: true })
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', isolated], { encoding: 'utf8' }))
    execFileSync('tar', ['-xzf', join(isolated, pack.filename), '-C', packaged, '--strip-components=1'])
    const entries = {
        '': 'createContributions',
        '/application': 'createApplicationDiagnostics',
        '/batch': 'validateBatch',
        '/installation-store': 'installationFileStore',
        '/node': 'fileConsentStore',
        '/protocol': 'validateProtocol',
        '/schema': 'validateContribution',
        '/settings': 'nodeDiagnostics',
    }
    for (const format of ['esm', 'commonjs']) {
        const checks = Object.entries(entries).map(([path, name]) => {
            const module = JSON.stringify('@darkgrade/slate/contribute' + path)
            return `if(typeof (${format === 'esm' ? 'await import' : 'require'}(${module}))[${JSON.stringify(name)}]!=='function')throw new Error(${JSON.stringify(path + ':' + name)})`
        }).join(';')
        execFileSync('node', [...(format === 'esm' ? ['--input-type=module'] : []), '-e', checks],
            { cwd: isolated, stdio: 'inherit' })
        const cli = format === 'esm' ? "await import('@darkgrade/slate/cli')" : "require('@darkgrade/slate/cli')"
        execFileSync('node', [...(format === 'esm' ? ['--input-type=module'] : []), '-e',
            `if(typeof (${cli}).runDarkgradeCli !== 'function')throw new Error('CLI runner is missing')`],
            { cwd: isolated, stdio: 'inherit' })
    }
    for (const path of ['', '/application', '/batch', '/protocol', '/schema']) {
        const entry = join(isolated, 'browser.ts')
        writeFileSync(entry, `export * from ${JSON.stringify('@darkgrade/slate/contribute' + path)}`)
        const result = await Bun.build({ entrypoints: [entry], target: 'browser' })
        if (!result.success) throw new AggregateError(result.logs, 'Browser diagnostics import failed: ' + path)
    }
    const controlsEntry = join(isolated, 'controls-browser.ts')
    writeFileSync(controlsEntry, "export * from '@darkgrade/slate/controls'")
    const controlsBuild = await Bun.build({ entrypoints: [controlsEntry], target: 'browser' })
    if (!controlsBuild.success) throw new AggregateError(controlsBuild.logs, 'Browser control vocabulary failed')
    writeFileSync(join(isolated, 'package.json'), JSON.stringify({ type: 'module' }))
    writeFileSync(join(isolated, 'types.ts'), `
        import { createApplicationDiagnostics, type InstallationState } from '@darkgrade/slate/contribute/application'
        import { type CameraContext } from '@darkgrade/slate/contribute/schema'
        import { type DiagnosticBatch } from '@darkgrade/slate/contribute/batch'
        import { nodeDiagnostics } from '@darkgrade/slate/contribute/settings'
        import { runDarkgradeCli } from '@darkgrade/slate/cli'
        const command: (args: readonly string[]) => Promise<number> = runDarkgradeCli
        const context: CameraContext = { manufacturer: 'Test', model: 'Fixture', firmware: '1',
            revision: 'abcdef0', dirty: false, transport: 'usb', evidence: 'synthetic' }
        const batch: DiagnosticBatch = { schema: 'darkgrade.diagnostic-batch/v2', id: 'fixture', contributions: [] }
        const state: InstallationState = { enabled: false, noticeVersion: 'fixture', withdrawalPending: false }
        void [context, batch, state, createApplicationDiagnostics, nodeDiagnostics, command]
    `)
    writeFileSync(join(isolated, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
            strict: true, noEmit: true, skipLibCheck: false, types: [], lib: ['ES2022', 'DOM'] },
        files: ['types.ts'],
    }))
    execFileSync('node', [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', join(isolated, 'tsconfig.json')],
        { stdio: 'inherit' })
    console.log('Packed ESM/CommonJS, strict NodeNext types and browser diagnostics passed without camera dependencies')

    // A library consumer uses the packed declarations, with no source aliases or skipLibCheck.
    // Slate's declared type/runtime dependencies are resolved independently of workspace sources.
    const require = createRequire(import.meta.url)
    mkdirSync(join(isolated, 'node_modules/@types'), { recursive: true })
    for (const name of ['node', 'w3c-web-usb'])
        symlinkSync(realpathSync(require.resolve(`@types/${name}/package.json`)).replace(/\/package\.json$/, ''),
            join(isolated, `node_modules/@types/${name}`), 'dir')
    symlinkSync(realpathSync(require.resolve('usb/package.json')).replace(/\/package\.json$/, ''),
        join(isolated, 'node_modules/usb'), 'dir')
    const consumer = `
        import { Camera, configureSlateTelemetry, genericOperationRegistry, genericPropertyRegistry, type DeviceInfo,
            type CameraCapabilities, type ExposureTime, type CameraControlSession, type CameraControlState,
            type CameraRecordingState, SonyWifiCamera, SonyCamera, type ShutterSpeed, type TypedSettingMethods,
            type Aperture, type Iso, type ExposureMode, type ExposureCompensation, type MeteringMode,
            type WhiteBalance, type PictureStyle, type PictureProfile, type PhotoVideoMode, type DriveMode,
            type FocusMode, type FocusArea, type FocusResult, type OperationAvailability,
            CameraRefusedError, CameraUnsupportedError, CameraOutcomeUnknownError,
            type CardPhoto, type ComputerPhoto, type PhotoFormat, type RawCompression,
            type CardStatus, type MediaItem, type Battery, type CameraInfo,
            type DigitalZoom, type LiveViewQuality, type LiveViewFrame, type FocusFrame, type CameraLens,
            TransportFactory, TransportType } from '@darkgrade/slate'
        import { exposureSeconds, resolveCameraControl } from '@darkgrade/slate/controls'
        import { CameraClipNotFoundError, type AudioRecording, type Clip, type FrameRate, type VideoFormat } from '@darkgrade/slate'
        const camera = new Camera()
        configureSlateTelemetry(undefined)
        const device: Promise<{code: number; data: DeviceInfo}> = camera.send(genericOperationRegistry.GetDeviceInfo, {})
        const capabilities: Promise<CameraCapabilities> = camera.getCapabilities()
        const exposure: Promise<ExposureTime> = camera.getExposureTime()
        const native: CameraControlSession = camera
        const sdk: CameraControlSession = new SonyWifiCamera({
            request: async () => ({}), close: async () => {}
        })
        camera.send(genericOperationRegistry.OpenSession, {SessionID: 1})
        camera.set(genericPropertyRegistry.WhiteBalance, 'Daylight')
        camera.setExposureTime({kind: 'angle', degrees: 180}, {framesPerSecond: 24000 / 1001})
        camera.setControl('colorTemperature', 5600)
        camera.setControl('iso', 'ISO 800')
        const observed: Promise<CameraControlState> = camera.setControl('shutterSpeed', {kind: 'angle', degrees: 180})
        const recording: Promise<CameraRecordingState> = camera.getRecordingState()
        // @ts-expect-error Exposure time is a search alias; shutterSpeed is the sole control id.
        camera.setControl('exposureTime', '1/60')
        // @ts-expect-error Internal transport preparation is not a shipped consumer API.
        camera.getInstance().connectTransport()
        // @ts-expect-error Discarded-driver telemetry disposal is an internal lifecycle operation.
        camera.getInstance().detachTransportObserver()
        const factory = new TransportFactory()
        factory.createIPTransport({ address: '127.0.0.1', timeout: 1000, telemetryEvidence: 'synthetic' })
        factory.createUSBTransport({ maxBulkReadBytes: 16384 })
        factory.create(TransportType.USB, { maxBulkReadBytes: 16384 })
        factory.create(TransportType.IP, { address: '127.0.0.1' })
        // @ts-expect-error IP creation requires an address-bearing option object.
        factory.create(TransportType.IP)
        // @ts-expect-error A USB transport cannot silently ignore IP options.
        factory.create(TransportType.USB, { address: '127.0.0.1' })
        // @ts-expect-error USB claim selection was never an implemented option.
        factory.createUSBTransport({ claimInterface: false })
        // @ts-expect-error Retry policy belongs to Camera transactions, not the transport factory.
        factory.createIPTransport({ address: '127.0.0.1', maxRetries: 3 })
        // @ts-expect-error USB timeout was never read by the transport.
        factory.createUSBTransport({ timeout: 1000 })
        const sony = null! as SonyCamera
        sony.set(sony.registry.properties.S1S2Button, 'DOWN')
        // @ts-expect-error Named registry shapes retain Sony's exact enum values.
        sony.set(sony.registry.properties.S1S2Button, 'INVALID')
        sony.get(sony.registry.properties.FocusIndication).then(focus => {
            // @ts-expect-error The result must retain the focus-state union.
            const invalid: typeof focus = 'INVALID_STATUS'
            void invalid
        })
        sony.on(sony.registry.events.SDIE_AFStatus, params => {
            // @ts-expect-error Event parameter codecs retain enum inference too.
            const invalid: typeof params.Status = 'INVALID_STATUS'
            void invalid
        })
        // @ts-expect-error Operation parameters have concrete numeric types.
        camera.send(genericOperationRegistry.OpenSession, {SessionID: 'one'})
        // @ts-expect-error Required operation parameters cannot be omitted.
        camera.send(genericOperationRegistry.OpenSession, {})
        // @ts-expect-error A property's codec defines its value type.
        camera.set(genericPropertyRegistry.WhiteBalance, 'daylight')
        // @ts-expect-error Known read-only definitions cannot be written through Camera.
        camera.set(genericPropertyRegistry.BatteryLevel, 40)
        // @ts-expect-error Controls have their own input types.
        camera.setControl('colorTemperature', '5600')
        // @ts-expect-error A numeric control must not widen the inferred id.
        camera.setControl('iso', {kind: 'angle', degrees: 180})
        // @ts-expect-error The public vocabulary rejects invented controls.
        camera.setControl('vendorMagic', 'on')
        // @ts-expect-error Angle values need a degrees field.
        camera.setExposureTime({kind: 'angle', seconds: 0.02})
        // Typed settings: one getter/setter per setting, canonical values, the value read back.
        const confirmedShutter: Promise<ShutterSpeed> = camera.setShutterSpeed('1/250')
        const currentShutter: Promise<ShutterSpeed> = camera.getShutterSpeed()
        camera.setShutterSpeed('180°', {framesPerSecond: 24000 / 1001})
        camera.setShutterSpeed({kind: 'duration', seconds: 1 / 60})
        sdk.setShutterSpeed('30"')
        const anyString: string = '1/250'
        // @ts-expect-error A typed setter never takes a plain string.
        camera.setShutterSpeed(anyString)
        // @ts-expect-error A vendor's own word is not a canonical shutter speed.
        camera.setShutterSpeed('fast')
        const confirmedAperture: Promise<Aperture> = camera.setAperture('f/2.8')
        const currentIso: Promise<Iso> = camera.getIso()
        camera.setIso('ISO 800')
        camera.setIso('Auto')
        const confirmedMode: Promise<ExposureMode> = camera.setExposureMode('Aperture priority')
        camera.setExposureMode('M')
        camera.setExposureMode('Tv')
        const confirmedCompensation: Promise<ExposureCompensation> = camera.setExposureCompensation('+0.7')
        const confirmedMetering: Promise<MeteringMode> = camera.setMeteringMode('Spot')
        sdk.setIso('ISO 100')
        // @ts-expect-error A typed setter never takes a plain string.
        camera.setAperture(anyString)
        // @ts-expect-error An ISO keeps its ISO prefix; Canon's raw '800' is not canonical.
        camera.setIso('800')
        // @ts-expect-error Exposure modes are words; Canon's AE code is not one.
        camera.setExposureMode('3')
        // @ts-expect-error Sony's movie-family word maps to Manual; it is not an exposure mode.
        camera.setExposureMode('Movie Manual')
        // @ts-expect-error Compensation is a signed number of stops, not a number.
        camera.setExposureCompensation(0.7)
        // @ts-expect-error Canon Evaluative and Nikon Matrix are both Multi.
        camera.setMeteringMode('Evaluative')
        // Colour and mode: canonical names from the vendor codecs, Kelvin as a number, photo or video.
        const confirmedWhiteBalance: Promise<WhiteBalance> = camera.setWhiteBalance('Daylight')
        const currentKelvin: Promise<number> = camera.getColorTemperature()
        camera.setColorTemperature(5600)
        const look: Promise<PictureStyle> = camera.setPictureStyle('Standard')
        const profile: Promise<PictureProfile> = camera.setPictureProfile('PP8')
        const mode: Promise<PhotoVideoMode> = camera.setPhotoVideoMode('video')
        const drive: Promise<DriveMode> = camera.setDriveMode('Continuous high')
        sdk.setWhiteBalance('Underwater Auto')
        // @ts-expect-error Nikon's own word for daylight is spelled Daylight.
        camera.setWhiteBalance('Sunny')
        // @ts-expect-error Canon's kebab-case codes are not canonical names.
        camera.setWhiteBalance('daylight')
        // One name per concept: ISO 15740's Manual white balance and every vendor preset are Custom.
        camera.setWhiteBalance('Custom')
        // @ts-expect-error Preset white balance is spelled Custom, not Manual.
        camera.setWhiteBalance('Manual')
        camera.setPictureStyle('Same as photo')
        // @ts-expect-error Same as photo is written in sentence case for white balance and look alike.
        camera.setWhiteBalance('Same as Photo')
        // @ts-expect-error A typed setter never takes a plain string.
        camera.setWhiteBalance(anyString)
        // @ts-expect-error Kelvin is a number.
        camera.setColorTemperature('5600')
        // @ts-expect-error Photo or video; Sony's own movie program names are not modes.
        camera.setPhotoVideoMode('Movie Manual')
        // @ts-expect-error A typed setter never takes a plain string.
        camera.setDriveMode(anyString)
        // @ts-expect-error A typed setter never takes a plain string.
        camera.setPictureStyle(anyString)
        // Photo: takePhoto returns the confirmed file; only a computer photo carries its bytes.
        const cardPhoto: Promise<CardPhoto> = camera.takePhoto()
        const computerPhoto: Promise<ComputerPhoto> = camera.takePhoto({ autofocus: false, destination: 'computer' })
        void camera.takePhoto({ destination: 'computer' }).then(photo => photo.data.byteLength + (photo.mediaId?.length ?? 0))
        // @ts-expect-error A card photo has no bytes; ask for destination 'computer'.
        void camera.takePhoto({ destination: 'card' }).then(photo => photo.data)
        // @ts-expect-error The destination is the card or the computer; 'memory' is not a destination.
        camera.takePhoto({ destination: 'memory' })
        // @ts-expect-error RAW compression is a setting (setRawCompression), not a photo option.
        camera.takePhoto({ rawCompression: 'lossless' })
        // @ts-expect-error The old capture name is not on a control session.
        sdk.takePhoto()
        const photoFormat: Promise<PhotoFormat> = camera.setPhotoFormat('RAW+JPEG')
        const rawCompression: Promise<RawCompression> = camera.setRawCompression('Lossless')
        camera.setPhotoSize('Large')
        camera.setAspectRatio('16:9')
        camera.setJpegQuality('Fine')
        camera.setFlashMode('Off')
        sdk.setPhotoFormat('RAW')
        // @ts-expect-error Photo formats use the codecs' canonical spelling.
        camera.setPhotoFormat('RAW + JPEG')
        // @ts-expect-error The old setting id is not a typed setter.
        camera.setStillFormat('RAW')
        // @ts-expect-error A flash mode is a canonical word, not the vendor's.
        camera.setFlashMode('Fill-flash')
        // @ts-expect-error A typed setter never takes a plain string.
        camera.setJpegQuality(anyString)
        type PlainStringSetters = { [Name in keyof TypedSettingMethods]: Name extends \`set\${string}\`
            ? TypedSettingMethods[Name] extends (value: infer Value, ...options: never[]) => unknown
                ? string extends Value ? Name : never : never
            : never }[keyof TypedSettingMethods]
        const noPlainStringSetters: [PlainStringSetters] extends [never] ? true : PlainStringSetters = true
        // Focus: a confirmed result, 0–1 points, named step sizes and canonical focus settings.
        const focused: Promise<FocusResult> = camera.autofocus()
        camera.setFocusPoint(0.5, 0.4)
        camera.setFocusPoint(0.5, 0.4, { autofocus: false })
        camera.resetFocusPoint()
        camera.nudgeFocus('near', 'small')
        const focusMode: Promise<FocusMode> = camera.setFocusMode('AF-C')
        const focusArea: Promise<FocusArea> = camera.getFocusArea()
        camera.setFocusArea('Wide')
        camera.setSubjectDetection('On')
        camera.setDetectionSubject('People')
        camera.setEyeSelection('Left')
        sdk.setFocusMode('MF')
        capabilities.then(found => {
            const availability: OperationAvailability | undefined = found.operations?.setFocusPoint
            void availability
        })
        // @ts-expect-error autofocus takes no duration; the camera decides how long it focuses.
        camera.autofocus(800)
        // @ts-expect-error autofocus reports acquired, not-acquired or unknown, never a bare boolean.
        const focusedFlag: Promise<boolean> = camera.autofocus()
        // @ts-expect-error A focus point needs both coordinates.
        camera.setFocusPoint(0.5)
        // @ts-expect-error The option is autofocus, not the old vendor-method focus flag.
        camera.setFocusPoint(0.5, 0.4, { focus: false })
        // @ts-expect-error Nudges are named sizes, never motor steps.
        camera.nudgeFocus('near', 3)
        // @ts-expect-error Focus moves near or far.
        camera.nudgeFocus('in', 'small')
        // @ts-expect-error Canon's One-Shot is a search alias; the canonical value is AF-S.
        camera.setFocusMode('one-shot')
        // @ts-expect-error Sony's Flexible Spot is a spot in Slate's words.
        camera.setFocusArea('Flexible Spot M')
        // @ts-expect-error Subject detection is On or Off, not a boolean.
        camera.setSubjectDetection(true)
        // @ts-expect-error Eye selection says Left or Right, not Sony's Left Eye.
        camera.setEyeSelection('Left Eye')
        // Card, media, body and events: generic operations with typed results.
        const cards: Promise<CardStatus[]> = camera.getCardStatus()
        const media: Promise<MediaItem[]> = camera.listMedia()
        const preview: Promise<Uint8Array> = camera.getMediaPreview('id', 'preview')
        const download: Promise<Uint8Array> = camera.downloadMedia('id', {
            onProgress: (receivedBytes: number, totalBytes: number) => void [receivedBytes, totalBytes],
            signal: new AbortController().signal,
        })
        const battery: Promise<Battery> = camera.getBattery()
        const clock: Promise<void> = camera.setClock(new Date())
        const info: Promise<CameraInfo> = camera.getInfo()
        const listMediaAvailability: Promise<OperationAvailability | undefined> =
            camera.getCapabilities().then(current => current.operations?.listMedia)
        camera.on('mediaAdded', () => {})
        camera.off('settingsChanged')
        // @ts-expect-error Operation availability is keyed by Camera's own method names.
        camera.getCapabilities().then(current => current.operations?.listMedias)
        // @ts-expect-error Preview sizes are thumbnail or preview.
        camera.getMediaPreview('id', 'large')
        // @ts-expect-error Media ids are the strings listMedia returns, not object handles.
        camera.downloadMedia(42)
        // @ts-expect-error setClock takes a Date.
        camera.setClock('2026-11-24T12:00:00')
        // @ts-expect-error The named events are settingsChanged and mediaAdded.
        camera.on('objectAdded', () => {})
        // @ts-expect-error A named event passes nothing to its handler.
        camera.on('mediaAdded', (item: MediaItem) => void item)
        // @ts-expect-error Battery power sources are a closed set.
        const invented: Battery['powerSource'] = 'solar'
        void [cards, media, preview, download, battery, clock, info, listMediaAvailability, invented]
        // Video: recording returns the confirmed clip; video settings take their codec names.
        const started: Promise<void> = camera.startRecording()
        const clip: Promise<Clip> = camera.stopRecording()
        clip.then(finished => { const name: string = finished.name; const id: string = finished.mediaId; void [name, id] })
        // @ts-expect-error startRecording takes no options; Slate prepares the camera itself.
        camera.startRecording({ mode: 'movie' })
        // @ts-expect-error stopRecording resolves to the clip, not a bare acknowledgement.
        const stopAcknowledged: Promise<void> = camera.stopRecording()
        // @ts-expect-error The recording state is a closed set.
        const inventedState: CameraRecordingState = 'paused'
        const frameRate: Promise<FrameRate> = camera.setFrameRate('24p')
        const videoFormat: Promise<VideoFormat> = camera.getVideoFormat()
        camera.setVideoFormat('XAVC S 4K')
        camera.setVideoFormat('4K 23.98 fps · MP4 · IPB (Standard)')
        camera.setVideoQuality('150M 4:2:0 10-bit')
        const audio: Promise<AudioRecording> = camera.setAudioRecording('Off')
        sdk.setFrameRate('60p')
        // @ts-expect-error A frame rate is a codec name such as 24p, not a number.
        camera.setFrameRate(24)
        // @ts-expect-error A typed video setter never takes a plain string.
        camera.setVideoQuality(anyString)
        // @ts-expect-error Movie sound is On or Off, not a vendor's own word.
        camera.setAudioRecording('auto')
        // @ts-expect-error The old Sony/Canon names are search aliases, not control ids.
        camera.setControl('movieFormat', 'XAVC S 4K')
        const clipErrors = [CameraClipNotFoundError]
        // Zoom and live view: millimetres, named directions and speeds, canonical setting values.
        const landed: Promise<number> = camera.zoomTo(35)
        camera.startZoom('in', {speed: 'slow'})
        camera.startZoom('out', {speed: 'fast'})
        const stopped: Promise<void> = camera.stopZoom()
        // @ts-expect-error A focal length is a number of millimetres, not text.
        camera.zoomTo('35mm')
        // @ts-expect-error Zoom directions are in and out, not a vendor's wide and tele.
        camera.startZoom('tele', {speed: 'fast'})
        // @ts-expect-error Zoom speeds are named, never motor steps.
        camera.startZoom('in', {speed: 3})
        // @ts-expect-error startZoom always names its speed.
        camera.startZoom('in')
        const frame: Promise<LiveViewFrame> = camera.getLiveViewFrame({overlay: true})
        camera.getLiveViewFrame().then(({jpeg, focusFrames, overlay}) => {
            const picture: Uint8Array = jpeg
            const frames: FocusFrame[] = focusFrames
            const display: Uint8Array | undefined = overlay?.png
            void [picture, frames, display]
        })
        // @ts-expect-error The overlay option is a boolean.
        camera.getLiveViewFrame({overlay: 'on'})
        // @ts-expect-error Vendor live-view fields are not part of the frame.
        camera.getLiveViewFrame().then(frame => frame.sonyFocalFrames)
        capabilities.then(({lens}) => { const reported: CameraLens | undefined = lens; void reported })
        const zoomSetting: Promise<DigitalZoom> = camera.setDigitalZoom('Clear Image Zoom')
        const quality: Promise<LiveViewQuality> = camera.getLiveViewQuality()
        camera.setLiveViewQuality('Low')
        sdk.setDigitalZoom('Off')
        // @ts-expect-error Sony's codec word maps to the canonical 'Off'.
        camera.setDigitalZoom('Optical Zoom Only')
        // @ts-expect-error Live-view quality is High or Low, not Sony's HIGH.
        camera.setLiveViewQuality('HIGH')
        // @ts-expect-error A typed setter never takes a plain string.
        camera.setLiveViewQuality(anyString)
        const errors = [CameraRefusedError, CameraUnsupportedError, CameraOutcomeUnknownError]
        void [started, clip, stopAcknowledged, inventedState, frameRate, videoFormat, audio, clipErrors]
        void [device, capabilities, exposure, observed, recording, exposureSeconds, resolveCameraControl, native, sdk,
            confirmedShutter, currentShutter, noPlainStringSetters, errors, confirmedAperture, currentIso, confirmedMode,
            confirmedCompensation, confirmedMetering, confirmedWhiteBalance, currentKelvin, look, profile, mode, drive,
            focused, focusMode, focusArea, focusedFlag, cardPhoto, computerPhoto, photoFormat, rawCompression,
            landed, stopped, frame, zoomSetting, quality]
    `
    for (const extension of ['ts', 'cts']) {
        writeFileSync(join(isolated, 'camera.' + extension), consumer)
        writeFileSync(join(isolated, 'camera-tsconfig.json'), JSON.stringify({
            compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
                strict: true, noEmit: true, skipLibCheck: false, types: ['node'], lib: ['ES2022', 'DOM'] },
            files: ['camera.' + extension],
        }))
        execFileSync('node', [require.resolve('typescript/bin/tsc'), '-p', join(isolated, 'camera-tsconfig.json')],
            { stdio: 'inherit' })
    }
    console.log('Packed camera ESM/CommonJS strict NodeNext types and rejected invalid inputs passed')
    // README fragments share only the documented Camera/fs context. Compile their
    // actual text against the tarball, so a separately maintained fixture cannot hide drift.
    const compiler = require('typescript') as typeof import('typescript')
    const readmeFiles: string[] = []
    for (const [name, path] of [
        ['root', join(import.meta.dirname, '../../../README.md')],
        ['slate', join(import.meta.dirname, '../README.md')],
        ['quickstart', join(import.meta.dirname, '../../../apps/docs/slate/getting_started/quickstart.mdx')],
        ['vendor-features', join(import.meta.dirname, '../../../apps/docs/slate/getting_started/vendor-features.mdx')],
        ['ptp-ip', join(import.meta.dirname, '../../../apps/docs/slate/getting_started/ptp-ip.mdx')],
    ] as const) {
        const markdown = readFileSync(path, 'utf8')
        let number = 0
        for (const match of markdown.matchAll(/^```(?:typescript|ts)\s*\n([\s\S]*?)^```/gm)) {
            const snippet = match[1]!
            const parsed = compiler.createSourceFile('readme.ts', snippet, compiler.ScriptTarget.Latest, true)
            const names = new Set<string>()
            for (const statement of parsed.statements) {
                if (compiler.isVariableStatement(statement))
                    for (const declaration of statement.declarationList.declarations)
                        if (compiler.isIdentifier(declaration.name)) names.add(declaration.name.text)
                if (!compiler.isImportDeclaration(statement)) continue
                const clause = statement.importClause
                if (clause?.name) names.add(clause.name.text)
                const bindings = clause?.namedBindings
                if (bindings && compiler.isNamespaceImport(bindings)) names.add(bindings.name.text)
                if (bindings && compiler.isNamedImports(bindings))
                    for (const binding of bindings.elements) names.add(binding.name.text)
            }
            const file = `readme-${name}-${++number}.mts`
            const context =
                (names.has('camera') ? '' : "declare const camera: import('@darkgrade/slate').Camera;\n") +
                (names.has('fs') ? '' : "declare const fs: typeof import('node:fs');\n")
            writeFileSync(join(isolated, file), context + snippet + '\nexport {}\n')
            readmeFiles.push(file)
        }
        if (!number) throw new Error('Documentation has no checked TypeScript examples: ' + path)
    }
    writeFileSync(join(isolated, 'readme-tsconfig.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
            strict: true, noEmit: true, skipLibCheck: false, types: ['node'], lib: ['ES2022', 'DOM'] },
        files: readmeFiles,
    }))
    execFileSync('node', [require.resolve('typescript/bin/tsc'), '-p', join(isolated, 'readme-tsconfig.json')],
        { stdio: 'inherit' })
    console.log(`Packed README TypeScript examples passed (${readmeFiles.length} fragments)`)
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8'))
    for (const name of Object.keys(manifest.dependencies)) {
        const target = join(isolated, 'node_modules', name)
        if (!existsSync(target))
            symlinkSync(realpathSync(join(import.meta.dirname, '../node_modules', name)), target, 'dir')
    }
    for (const format of ['esm', 'commonjs']) {
        const load = format === 'esm' ? "await import('@darkgrade/slate')" : "require('@darkgrade/slate')"
        const loadControls = format === 'esm' ? "await import('@darkgrade/slate/controls')" : "require('@darkgrade/slate/controls')"
        execFileSync('node', [...(format === 'esm' ? ['--input-type=module'] : []), '-e',
            `const controls=${loadControls};` +
            `for(const alias of ['shutterSpeed','shutter speed','shutter angle','shutterAngle','exposure time','exposureTime'])` +
            `if(controls.resolveCameraControl(alias)!=='shutterSpeed')throw Error('Packed alias drift: '+alias);` +
            `if(controls.resolveCameraControl('inventedControl')!==undefined)throw Error('Invented control alias was accepted');` +
            `if(controls.exposureSeconds('180°',{framesPerSecond:24})!==1/48)throw Error('Angle conversion lost its frame context');` +
            `let refused=false;try{controls.exposureSeconds('180°')}catch{refused=true}` +
            `if(!refused)throw Error('Angle conversion must require actual frame rate');`],
            { cwd: isolated, stdio: 'inherit' })
        execFileSync('node', [...(format === 'esm' ? ['--input-type=module'] : []), '-e',
            `const api=${load}; const log=console.log, handlers=process.listenerCount('uncaughtException');` +
            `new api.Camera(); if(console.log!==log||process.listenerCount('uncaughtException')!==handlers)throw Error('Library constructor changes the host');` +
            `if(api.parseExposureTime('180°').kind!=='angle')throw Error('Packed exposure API is missing');`],
            { cwd: isolated, stdio: 'inherit' })
        execFileSync('node', [...(format === 'esm' ? ['--input-type=module'] : []), '-e',
            `const api=${load};(async()=>{const log=console.log;const factory=new api.TransportFactory();` +
            `await factory.createUSBTransport();await factory.createIPTransport({address:'127.0.0.1'});` +
            `if((await factory.create(api.TransportType.USB)).getType()!=='usb')throw Error('Wrong USB dispatch');` +
            `if((await factory.create(api.TransportType.IP,{address:'127.0.0.1'})).getType()!=='ip')throw Error('Wrong IP dispatch');` +
            `for(const [type,options] of [[api.TransportType.USB,{address:'127.0.0.1'}],[api.TransportType.IP,undefined]])` +
            `if(!await factory.create(type,options).then(()=>false,()=>true))throw Error('Invalid factory options were accepted');` +
            `if(console.log!==log)throw Error('Transport factory changes the host console');})()` +
            `.catch(error=>{console.error(error);process.exitCode=1})`],
            { cwd: isolated, stdio: 'inherit' })
        for (const trigger of [
            "throw new Error('packed-logger-fatal')",
            "Promise.reject(new Error('packed-logger-fatal'))",
        ]) {
            const result = spawnSync('node', [
                '--unhandled-rejections=strict', ...(format === 'esm' ? ['--input-type=module'] : []), '-e',
                `const api=${load};new api.Camera({logger:{renderInTerminal:true,captureConsole:false}});` +
                `setTimeout(()=>{${trigger}},50)`,
            ], { cwd: isolated, encoding: 'utf8', timeout: 10_000 })
            if (result.error || result.status !== 1 || !result.stderr.includes('packed-logger-fatal'))
                throw new Error('Terminal logging must preserve fatal process exits: ' + format, { cause: result.error })
        }
    }
    console.log('Packed camera runtime imports passed using only declared runtime dependencies')
} finally {
    rmSync(isolated, { recursive: true, force: true })
}

// Resolve the public package exports under Node, rather than importing source
// under Bun/Vitest, which can accept a mislabeled CommonJS file.
for(const format of ['esm','commonjs']){
    const load=format==='esm'?"const api=await import('@darkgrade/slate')":"const api=require('@darkgrade/slate')"
    const check=load+"; for(const name of ['Camera','configureSlateTelemetry','VideoTake','optimiseShot','readCameraPower','readNikonRecordingStatus'])if(typeof api[name]!=='function')throw new Error(name+' is missing');console.log('Built '+"+JSON.stringify(format)+"+' exports passed')"
    execFileSync('node',[...(format==='esm'?['--input-type=module']:[]),'-e',check],{stdio:'inherit'})
}

