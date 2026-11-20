import {execFileSync, spawnSync} from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync, realpathSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// The shared runtime's entries: each must load under Node in both formats, and the browser
// entry must leave out the Node-only lease coordinator that the default entry carries.
for(const format of ['esm','commonjs']){
    const load=(name:string)=>format==='esm'?`await import('${name}')`:`require('${name}')`
    const check=`const runtime=${load('@darkgrade/link/runtime')},browser=${load('@darkgrade/link/runtime/browser')},mcp=${load('@darkgrade/link/runtime/mcp')},ownership=${load('@darkgrade/link/runtime/ownership')};`+
        "for(const [api,names] of [[runtime,['CameraRuntime','HttpCameraClient','HardwareCoordinator','HardwareBusyError']],[browser,['CameraRuntime','HttpCameraClient']],[mcp,['createCameraMcpServer','registerCameraTools']],[ownership,['HardwareCoordinator']]])for(const name of names)if(typeof api[name]!=='function')throw new Error(name+' is missing');"+
        "if('HardwareCoordinator' in browser)throw new Error('The browser entry must not carry the Node lease coordinator');console.log('Built '+"+JSON.stringify(format)+"+' runtime exports passed')"
    execFileSync('node',[...(format==='esm'?['--input-type=module']:[]),'-e',check],{stdio:'inherit'})
}

// A packed Link must serve diagnostics without the USB, terminal or MCP dependencies.
// The isolated directory has no workspace symlinks or installed third-party packages.
const isolated = mkdtempSync(join(tmpdir(), 'darkgrade-link-diagnostics-'))
try {
    const packaged = join(isolated, 'node_modules/@darkgrade/link')
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
            const module = JSON.stringify('@darkgrade/link/contribute' + path)
            return `if(typeof (${format === 'esm' ? 'await import' : 'require'}(${module}))[${JSON.stringify(name)}]!=='function')throw new Error(${JSON.stringify(path + ':' + name)})`
        }).join(';')
        execFileSync('node', [...(format === 'esm' ? ['--input-type=module'] : []), '-e', checks],
            { cwd: isolated, stdio: 'inherit' })
        const cli = format === 'esm' ? "await import('@darkgrade/link/cli')" : "require('@darkgrade/link/cli')"
        execFileSync('node', [...(format === 'esm' ? ['--input-type=module'] : []), '-e',
            `if(typeof (${cli}).runDarkgradeCli !== 'function')throw new Error('CLI runner is missing')`],
            { cwd: isolated, stdio: 'inherit' })
    }
    for (const path of ['', '/application', '/batch', '/protocol', '/schema']) {
        const entry = join(isolated, 'browser.ts')
        writeFileSync(entry, `export * from ${JSON.stringify('@darkgrade/link/contribute' + path)}`)
        const result = await Bun.build({ entrypoints: [entry], target: 'browser' })
        if (!result.success) throw new AggregateError(result.logs, 'Browser diagnostics import failed: ' + path)
    }
    const controlsEntry = join(isolated, 'controls-browser.ts')
    writeFileSync(controlsEntry, "export * from '@darkgrade/link/controls'")
    const controlsBuild = await Bun.build({ entrypoints: [controlsEntry], target: 'browser' })
    if (!controlsBuild.success) throw new AggregateError(controlsBuild.logs, 'Browser control vocabulary failed')
    writeFileSync(join(isolated, 'package.json'), JSON.stringify({ type: 'module' }))
    writeFileSync(join(isolated, 'types.ts'), `
        import { createApplicationDiagnostics, type InstallationState } from '@darkgrade/link/contribute/application'
        import { type CameraContext } from '@darkgrade/link/contribute/schema'
        import { type DiagnosticBatch } from '@darkgrade/link/contribute/batch'
        import { nodeDiagnostics } from '@darkgrade/link/contribute/settings'
        import { runDarkgradeCli } from '@darkgrade/link/cli'
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
    // Link's declared type/runtime dependencies are resolved independently of workspace sources.
    const require = createRequire(import.meta.url)
    mkdirSync(join(isolated, 'node_modules/@types'), { recursive: true })
    for (const name of ['node', 'w3c-web-usb'])
        symlinkSync(realpathSync(require.resolve(`@types/${name}/package.json`)).replace(/\/package\.json$/, ''),
            join(isolated, `node_modules/@types/${name}`), 'dir')
    symlinkSync(realpathSync(require.resolve('usb/package.json')).replace(/\/package\.json$/, ''),
        join(isolated, 'node_modules/usb'), 'dir')
    const consumer = `
        import { Camera, genericOperationRegistry, genericPropertyRegistry, type DeviceInfo,
            type CameraCapabilities, type ExposureTime, type CameraControlSession, SonyWifiCamera, SonyCamera } from '@darkgrade/link'
        import { exposureSeconds, resolveCameraControl } from '@darkgrade/link/controls'
        const camera = new Camera()
        const device: Promise<{code: number; data: DeviceInfo}> = camera.send(genericOperationRegistry.GetDeviceInfo, {})
        const capabilities: Promise<CameraCapabilities> = camera.getCapabilities()
        const exposure: Promise<ExposureTime> = camera.getExposureTime()
        const native: CameraControlSession = camera
        const sdk: CameraControlSession = new SonyWifiCamera({
            request: async () => ({}), close: async () => {}
        })
        camera.send(genericOperationRegistry.OpenSession, {SessionID: 1})
        camera.set(genericPropertyRegistry.WhiteBalance, 2)
        camera.setExposureTime({kind: 'angle', degrees: 180}, {framesPerSecond: 24000 / 1001})
        camera.setControl('colorTemperature', 5600)
        camera.setControl('iso', 'ISO 800')
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
        void [device, capabilities, exposure, exposureSeconds, resolveCameraControl, native, sdk]
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
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8'))
    for (const name of Object.keys(manifest.dependencies)) {
        const target = join(isolated, 'node_modules', name)
        if (!existsSync(target))
            symlinkSync(realpathSync(join(import.meta.dirname, '../node_modules', name)), target, 'dir')
    }
    for (const format of ['esm', 'commonjs']) {
        const load = format === 'esm' ? "await import('@darkgrade/link')" : "require('@darkgrade/link')"
        execFileSync('node', [...(format === 'esm' ? ['--input-type=module'] : []), '-e',
            `const api=${load}; const log=console.log, handlers=process.listenerCount('uncaughtException');` +
            `new api.Camera(); if(console.log!==log||process.listenerCount('uncaughtException')!==handlers)throw Error('Library constructor changes the host');` +
            `if(api.parseExposureTime('180°').kind!=='angle')throw Error('Packed exposure API is missing');`],
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
    const load=format==='esm'?"const api=await import('@darkgrade/link')":"const api=require('@darkgrade/link')"
    const check=load+"; for(const name of ['Camera','VideoTake','optimiseShot','readCameraPower','readNikonRecordingStatus'])if(typeof api[name]!=='function')throw new Error(name+' is missing');console.log('Built '+"+JSON.stringify(format)+"+' exports passed')"
    execFileSync('node',[...(format==='esm'?['--input-type=module']:[]),'-e',check],{stdio:'inherit'})
}

