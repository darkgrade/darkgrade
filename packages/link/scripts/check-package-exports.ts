import {execFileSync} from 'node:child_process'

// The shared runtime's entries: each must load under Node in both formats, and the browser
// entry must leave out the Node-only lease coordinator that the default entry carries.
for(const format of ['esm','commonjs']){
    const load=(name:string)=>format==='esm'?`await import('${name}')`:`require('${name}')`
    const check=`const runtime=${load('@darkgrade/link/runtime')},browser=${load('@darkgrade/link/runtime/browser')},mcp=${load('@darkgrade/link/runtime/mcp')},ownership=${load('@darkgrade/link/runtime/ownership')};`+
        "for(const [api,names] of [[runtime,['CameraRuntime','HttpCameraClient','HardwareCoordinator','HardwareBusyError']],[browser,['CameraRuntime','HttpCameraClient']],[mcp,['createCameraMcpServer','registerCameraTools']],[ownership,['HardwareCoordinator']]])for(const name of names)if(typeof api[name]!=='function')throw new Error(name+' is missing');"+
        "if('HardwareCoordinator' in browser)throw new Error('The browser entry must not carry the Node lease coordinator');console.log('Built '+"+JSON.stringify(format)+"+' runtime exports passed')"
    execFileSync('node',[...(format==='esm'?['--input-type=module']:[]),'-e',check],{stdio:'inherit'})
}

// Resolve the public package exports under Node, rather than importing source
// under Bun/Vitest, which can accept a mislabeled CommonJS file.
for(const format of ['esm','commonjs']){
    const load=format==='esm'?"const api=await import('@darkgrade/link')":"const api=require('@darkgrade/link')"
    const check=load+"; for(const name of ['Camera','VideoTake','optimiseShot','readCameraPower','readNikonRecordingStatus'])if(typeof api[name]!=='function')throw new Error(name+' is missing');console.log('Built '+"+JSON.stringify(format)+"+' exports passed')"
    execFileSync('node',[...(format==='esm'?['--input-type=module']:[]),'-e',check],{stdio:'inherit'})
}

