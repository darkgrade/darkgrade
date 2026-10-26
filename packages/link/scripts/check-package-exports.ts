import {execFileSync} from 'node:child_process'

// Resolve the public package exports under Node, rather than importing source
// under Bun/Vitest, which can accept a mislabeled CommonJS file.
for(const format of ['esm','commonjs']){
    const load=format==='esm'?"const api=await import('@darkgrade/link')":"const api=require('@darkgrade/link')"
    const check=load+"; for(const name of ['Camera','VideoTake','optimiseShot','readCameraPower','readNikonRecordingStatus'])if(typeof api[name]!=='function')throw new Error(name+' is missing');console.log('Built '+"+JSON.stringify(format)+"+' exports passed')"
    execFileSync('node',[...(format==='esm'?['--input-type=module']:[]),'-e',check],{stdio:'inherit'})
}
