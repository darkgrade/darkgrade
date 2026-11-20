import {execFileSync} from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

