import {describe,it,expect,vi} from 'vitest'
import {VideoTake,type TakeCamera} from '@workflows/video-take'
type Collected=Parameters<TakeCamera['collect']>[0]
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

it('releases a finished camera before waiting for another camera transfer',async()=>{
 const f=fixture();await f.take.start();await f.take.stop();f.calls.length=0
 f.devices.get('two')!.collect=async files=>{
  expect(f.calls).toContain('close:one')
  expect(f.take.state.cameras[0].state).toBe('collected')
  return files.map(file=>({...file,downloadUrl:'/files/'+file.id}))
 }
 await f.take.collect();expect(f.take.state.stage).toBe('complete')
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
 it.each([
  ['stop after preparing',async(take:VideoTake)=>{await take.prepare();await take.stop()}],
  ['cancel before record',async(take:VideoTake)=>{await take.prepare();take.requestStop();await take.start()}],
 ] as const)('ends an armed take without ready cameras, record or stop commands (%s)',async(_case,cancel)=>{
  const fixtureState=fixture();let starts=0
  for(const camera of fixtureState.devices.values())camera.start=async()=>{starts++;return {recordingConfirmed:true,evidence:'started'}}
  await cancel(fixtureState.take)
  expect(starts).toBe(0);expect(fixtureState.take.state.stage).toBe('review');expect(fixtureState.take.state.cameras.every(camera=>camera.state==='stopped')).toBe(true)
  expect(fixtureState.calls.filter(call=>call.startsWith('stop:'))).toHaveLength(0)
 })
 it('clears prepared peers when another camera cannot prepare',async()=>{
  const fixtureState=fixture();fixtureState.devices.get('two')!.prepare=async()=>{throw new Error('No card')}
  await fixtureState.take.prepare();expect(fixtureState.take.state.stage).toBe('attention');expect(fixtureState.take.state.cameras[0].state).toBe('stopped');expect(fixtureState.take.state.cameras[1].state).toBe('error')
 })
 it.each([
  ['duplicate results that omit an original',(files:Collected)=>[files[0],files[0]].map(file=>({...file,downloadUrl:'/files/a'}))],
  ['a changed filename with the same ID and byte count',(files:Collected)=>files.map(file=>({...file,filename:'different.mp4',downloadUrl:'/files/'+file.id}))],
  ['a driver mutating its collection input',(files:Collected)=>{files[0].bytes=200;return files.map(file=>({...file,downloadUrl:'/files/'+file.id}))}],
 ] as const)('rejects transfer results that do not match the stopped originals: %s',async(_case,collect)=>{
  const fixtureState=fixture();fixtureState.devices.get('one')!.stop=async()=>({stopped:true,media:[{id:'a',filename:'a.mp4',bytes:100,verified:true},{id:'b',filename:'b.mp4',bytes:100,verified:true}]})
  await fixtureState.take.start();await fixtureState.take.stop()
  fixtureState.devices.get('one')!.collect=async files=>collect(files)
  await fixtureState.take.collect();expect(fixtureState.take.state.stage).toBe('attention');expect(fixtureState.take.state.cameras[0].state).not.toBe('collected')
  expect(fixtureState.take.state.cameras[0].error).toContain('did not match');expect(fixtureState.take.state.cameras[0].media.map(file=>file.bytes)).toEqual([100,100])
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

for (const individual of [false,true]) it(`retains the first stop request separately from delayed completion (${individual ? 'single' : 'all'})`,async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-13T18:00:00Z'))
 try{
  const f=fixture();await f.take.start();vi.setSystemTime(new Date('2026-11-13T18:00:20Z'))
  f.failures.add('one');await (individual?f.take.stopCamera('one'):f.take.stop())
  expect(f.take.state.cameras[0].stopRequestedAt).toBe('2026-11-13T18:00:20.000Z')
  expect(f.take.state.cameras[0].stoppedAt).toBeUndefined()
  vi.setSystemTime(new Date('2026-11-13T18:00:45Z'));await f.take.stop()
  expect(f.take.state.cameras[0].stopRequestedAt).toBe('2026-11-13T18:00:20.000Z')
  expect(f.take.state.cameras[0].stoppedAt).toBe('2026-11-13T18:00:45.000Z')
 }finally{vi.useRealTimers()}
})
