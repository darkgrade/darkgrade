import {describe,it,expect} from 'vitest'
import {inspectMovieTrackHandlers,readCameraMovieAudio} from '@camera/movie-audio'
function box(type:string,...parts:Uint8Array[]){const length=parts.reduce((n,b)=>n+b.length,8),out=new Uint8Array(length);new DataView(out.buffer).setUint32(0,length);out.set([...type].map(c=>c.charCodeAt(0)),4);let offset=8;for(const part of parts){out.set(part,offset);offset+=part.length}return out}
function track(type:string){return box('trak',box('mdia',box('hdlr',new Uint8Array(8),new TextEncoder().encode(type))))}
describe('Original card movie audio inspection',()=>{
 it('requires a structural audio handler and recognizes video-only movies',()=>{
  expect(inspectMovieTrackHandlers(box('moov',track('vide'),track('soun'))).status).toBe('present')
  expect(inspectMovieTrackHandlers(box('moov',track('vide'))).status).toBe('absent')
  expect(inspectMovieTrackHandlers(box('moov',box('free',new TextEncoder().encode('soun')))).status).toBe('unverified')
 })
 it('ignores audio handlers outside a movie media track',()=>{
  const misplaced=box('hdlr',new Uint8Array(8),new TextEncoder().encode('soun'))
  expect(inspectMovieTrackHandlers(box('moov',track('vide'),misplaced)).status).toBe('absent')
  expect(inspectMovieTrackHandlers(box('moov',track('soun'))).status).toBe('unverified')
 })
 it('does not turn malformed metadata into a claim of missing sound',()=>{
  expect(inspectMovieTrackHandlers(Uint8Array.of(0,0,0,100,109,111,111,118)).status).toBe('unverified')
 })
 it('skips video bytes and reads only a bounded moov atom',async()=>{
  const data=box('ftyp',new Uint8Array(4)),video=box('mdat',new Uint8Array(1024)),metadata=box('moov',track('vide'),track('soun'))
  const bytes=new Uint8Array(data.length+video.length+metadata.length);bytes.set(data);bytes.set(video,data.length);bytes.set(metadata,data.length+video.length)
  const counts:number[]=[]
  const camera:any={getInstance:()=>({registry:{operations:{GetPartialObject:{}}}}),send:async(_:any,p:any)=>{counts.push(p.MaxBytes);return {code:0x2001,data:bytes.subarray(p.Offset,p.Offset+p.MaxBytes)}}}
  expect((await readCameraMovieAudio(camera,{handle:4,filename:'MVI.MP4',objectCompressedSize:bytes.length})).status).toBe('present')
  expect(counts).toEqual([8,8,8,metadata.length])
 })
 it('reports incomplete camera reads as unverified',async()=>{
  const camera:any={getInstance:()=>({registry:{operations:{GetPartialObject:{}}}}),send:async()=>({code:0x2001,data:new Uint8Array(3)})}
  expect((await readCameraMovieAudio(camera,{handle:4,filename:'MVI.MP4',objectCompressedSize:100})).status).toBe('unverified')
 })
})
