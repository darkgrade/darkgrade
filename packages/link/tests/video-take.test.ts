import {describe,it,expect} from 'vitest'
import {VideoTake,type TakeCamera} from '@workflows/video-take'
function fixture(){
 const calls:string[]=[],failures=new Set<string>(),devices=new Map<string,TakeCamera>()
 for(const camera of ['one','two'])devices.set(camera,{prepare:async()=>{calls.push('prepare:'+camera)},start:async()=>({recordingConfirmed:true,evidence:'camera acknowledged'}),stop:async()=>{calls.push('stop:'+camera);if(failures.delete(camera))throw new Error('temporary stop failure');return {stopped:true,media:[{id:camera,filename:camera+'.mp4',bytes:100,verified:true}]}},collect:async files=>files.map(file=>({...file,downloadUrl:'/files/'+file.id})),close:async()=>{calls.push('close:'+camera)}})
 return {calls,failures,devices,take:new VideoTake('take','Reliability',devices,1)}
}
describe('recording take reliability',()=>{
 it('stops just one member and preserves the other recorder',async()=>{const f=fixture();await f.take.start();await f.take.stopCamera('one');expect(f.calls.filter(call=>call.startsWith('stop:'))).toEqual(['stop:one']);expect(f.take.state.stage).toBe('recording');expect(f.take.state.cameras.map(camera=>camera.state)).toEqual(['stopped','recording']);expect(f.take.state.cameras[0].media[0].filename).toBe('one.mp4');expect(f.take.hasUnstoppedCameras()).toBe(true)})
 it('collects both originals after the final member stops',async()=>{const f=fixture();await f.take.start();await f.take.stopCamera('one');await expect(f.take.collect()).rejects.toThrow('Confirm all cameras stopped');await f.take.stopCamera('two');expect(f.take.state.stage).toBe('review');expect(f.take.hasUnstoppedCameras()).toBe(false);await f.take.collect();expect(f.take.state.stage).toBe('complete');expect(f.take.state.cameras.every(camera=>camera.media[0].downloadUrl)).toBe(true)})
 it('keeps failed stops uncertain and permits a safe global retry',async()=>{const f=fixture();await f.take.start();f.failures.add('one');await f.take.stopCamera('one');expect(f.take.state.cameras[0].state).toBe('uncertain');expect(f.take.state.cameras[1].state).toBe('recording');await f.take.stop();expect(f.take.state.cameras.map(camera=>camera.state)).toEqual(['stopped','stopped']);expect(f.take.state.stage).toBe('review');expect(f.take.state.cameras[0].error).toBeUndefined()})
 it('rejects overlapping member stops and honors a global cancellation',async()=>{const f=fixture();await f.take.start();let release!:()=>void;const original=f.devices.get('one')!.stop;f.devices.get('one')!.stop=async()=>{await new Promise<void>(resolve=>{release=resolve});return original()};const stopping=f.take.stopCamera('one');await expect(f.take.stopCamera('two')).rejects.toThrow('still running');f.take.requestStop();release();await stopping;expect(f.take.state.stage).toBe('review');expect(f.take.hasUnstoppedCameras()).toBe(false);expect(f.calls.filter(call=>call.startsWith('stop:'))).toEqual(['stop:one','stop:two'])})
 it('rejects an unknown member without touching any recorder',async()=>{const f=fixture();await f.take.start();await expect(f.take.stopCamera('missing')).rejects.toThrow('not part');expect(f.calls.filter(call=>call.startsWith('stop:'))).toEqual([])})
 it('makes repeated member stop idempotent',async()=>{const f=fixture();await f.take.start();await f.take.stopCamera('one');await f.take.stopCamera('one');expect(f.calls.filter(call=>call==='stop:one')).toHaveLength(1)})
})

it('finishes verified transfer progress at 100 percent even when the SDK last reports a partial buffer',async()=>{
 const f=fixture();await f.take.start();await f.take.stop()
 f.devices.get('one')!.collect=async(files,progress)=>{progress(80,100);return files.map(file=>({...file,downloadUrl:'/files/'+file.id}))}
 await f.take.collect()
 expect(f.take.state.cameras[0]).toMatchObject({state:'collected',transferredBytes:100,totalBytes:100})
})

it.each(['recording','stopping','ready','preparing','uncertain'] as const)('never resumes collection while a member remains %s',state=>{
 const f=fixture(),snapshot=structuredClone(f.take.state)
 snapshot.stage='attention';snapshot.cameras[0].state=state;snapshot.cameras[1].state='stopped'
 expect(()=>VideoTake.resume(snapshot,f.devices)).toThrow('Confirm all recording stopped')
})

it('retries one explicitly recoverable collection failure and publishes recovery feedback',async()=>{
 const f=fixture();await f.take.start();await f.take.stop();let attempts=0;const statuses:string[]=[]
 ;(f.take as any).publish=(state:any)=>{if(state.cameras[0].transferRecovery)statuses.push(state.cameras[0].transferRecovery)}
 f.devices.get('one')!.collect=async files=>{if(++attempts===1)throw Object.assign(new Error('Transfer stalled'),{retryable:true});return files.map(file=>({...file,downloadUrl:'/files/'+file.id}))}
 await f.take.collect();expect(attempts).toBe(2);expect(f.take.state.stage).toBe('complete');expect(statuses[0]).toContain('retrying automatically');expect(f.take.state.cameras[0].transferRecovery).toBeUndefined()
})
it('never automatically retries file identity or storage errors without explicit retryability',async()=>{
 const f=fixture();await f.take.start();await f.take.stop();let attempts=0
 f.devices.get('one')!.collect=async()=>{attempts++;throw new Error('File identity changed')}
 await f.take.collect();expect(attempts).toBe(1);expect(f.take.state.stage).toBe('attention');expect(f.take.state.cameras[1].state).toBe('collected')
})
it('bounds repeated transfer failures and clears the active recovery indicator',async()=>{
 const f=fixture();await f.take.start();await f.take.stop();let attempts=0
 f.devices.get('one')!.collect=async()=>{attempts++;throw Object.assign(new Error('Transfer stalled'),{retryable:true})}
 await f.take.collect();expect(attempts).toBe(2);expect(f.take.state.stage).toBe('attention');expect(f.take.state.cameras[0].transferRecovery).toBeUndefined();expect(f.take.state.cameras[0].error).toBe('Transfer stalled')
})


describe('cancelled preparation and file identity',()=>{
 it('stops an armed take without leaving ready cameras or issuing record',async()=>{
  const fixtureState=fixture();let starts=0
  for(const camera of fixtureState.devices.values())camera.start=async()=>{starts++;return {recordingConfirmed:true,evidence:'started'}}
  await fixtureState.take.prepare();await fixtureState.take.stop()
  expect(starts).toBe(0);expect(fixtureState.take.state.stage).toBe('review');expect(fixtureState.take.state.cameras.every(camera=>camera.state==='stopped')).toBe(true)
  expect(fixtureState.calls.filter(call=>call.startsWith('stop:'))).toHaveLength(0)
 })
 it('does not commit record after cancellation of an armed take',async()=>{
  const fixtureState=fixture();let starts=0
  for(const camera of fixtureState.devices.values())camera.start=async()=>{starts++;return {recordingConfirmed:true,evidence:'started'}}
  await fixtureState.take.prepare();fixtureState.take.requestStop();await fixtureState.take.start()
  expect(starts).toBe(0);expect(fixtureState.take.state.stage).toBe('review');expect(fixtureState.take.state.cameras.every(camera=>camera.state==='stopped')).toBe(true)
 })
 it('clears prepared peers when another camera cannot prepare',async()=>{
  const fixtureState=fixture();fixtureState.devices.get('two')!.prepare=async()=>{throw new Error('No card')}
  await fixtureState.take.prepare();expect(fixtureState.take.state.stage).toBe('attention');expect(fixtureState.take.state.cameras[0].state).toBe('stopped');expect(fixtureState.take.state.cameras[1].state).toBe('error')
 })
 it('rejects duplicate transfer results that omit an original file',async()=>{
  const fixtureState=fixture();fixtureState.devices.get('one')!.stop=async()=>({stopped:true,media:[{id:'a',filename:'a.mp4',bytes:100,verified:true},{id:'b',filename:'b.mp4',bytes:100,verified:true}]})
  await fixtureState.take.start();await fixtureState.take.stop()
  fixtureState.devices.get('one')!.collect=async files=>[files[0],files[0]].map(file=>({...file,downloadUrl:'/files/a'}))
  await fixtureState.take.collect();expect(fixtureState.take.state.stage).toBe('attention');expect(fixtureState.take.state.cameras[0].state).not.toBe('collected');expect(fixtureState.take.state.cameras[0].error).toContain('did not match')
 })
 it('rejects changed filenames even when ID and byte count match',async()=>{
  const fixtureState=fixture();await fixtureState.take.start();await fixtureState.take.stop()
  fixtureState.devices.get('one')!.collect=async files=>files.map(file=>({...file,filename:'different.mp4',downloadUrl:'/files/'+file.id}))
  await fixtureState.take.collect();expect(fixtureState.take.state.stage).toBe('attention')
 })
 it('rejects duplicated saved camera identities before resuming any driver',()=>{
  const fixtureState=fixture(),state=structuredClone(fixtureState.take.state);state.stage='review';state.cameras=state.cameras.map(camera=>({...camera,state:'stopped',camera:'one'}))
  expect(()=>VideoTake.resume(state,fixtureState.devices)).toThrow('distinct camera identities')
 })
})


it('reserves start across the asynchronous prepare-to-record boundary',async()=>{
 const fixtureState=fixture();let starts=0,competing:Promise<unknown>|undefined
 for(const camera of fixtureState.devices.values())camera.start=async()=>{starts++;return {recordingConfirmed:true,evidence:'confirmed'}}
 const take=new VideoTake('race','Race',fixtureState.devices,1,state=>{if(state.stage==='armed'&&!competing)competing=Promise.resolve().then(()=>take.start()).catch(error=>error)})
 await take.start();expect(await competing).toBeInstanceOf(Error);expect(starts).toBe(2);await take.stop()
})
it('a driver cannot change expected file identity by mutating its collection input',async()=>{
 const fixtureState=fixture();await fixtureState.take.start();await fixtureState.take.stop()
 fixtureState.devices.get('one')!.collect=async files=>{files[0].bytes=200;return files.map(file=>({...file,downloadUrl:'/files/'+file.id}))}
 await fixtureState.take.collect();expect(fixtureState.take.state.stage).toBe('attention');expect(fixtureState.take.state.cameras[0].media[0].bytes).toBe(100)
})
