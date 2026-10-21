export interface CameraMovieAudio {status:'present'|'absent'|'unverified';detail:string}
function atom(bytes:Uint8Array,offset:number,end:number){
    if(offset+8>end)throw new Error('Incomplete movie atom header')
    const view=new DataView(bytes.buffer,bytes.byteOffset+offset,end-offset)
    const size=view.getUint32(0),type=String.fromCharCode(...bytes.subarray(offset+4,offset+8))
    if(size<8||offset+size>end)throw new Error('Invalid movie atom size')
    return {size,type,payload:offset+8,end:offset+size}
}
/** Inspect track handlers structurally; a substring inside compressed video is not audio proof. */
export function inspectMovieTrackHandlers(bytes:Uint8Array):CameraMovieAudio{
    const handlers:string[]=[]
    const visit=(start:number,end:number,depth:number)=>{
        if(depth>4)throw new Error('Movie metadata nesting exceeds the inspection limit')
        for(let offset=start;offset<end;){
            const entry=atom(bytes,offset,end)
            if(['moov','trak','mdia'].includes(entry.type))visit(entry.payload,entry.end,depth+1)
            if(entry.type==='hdlr'){
                if(entry.end-entry.payload<12)throw new Error('Incomplete movie track handler')
                handlers.push(String.fromCharCode(...bytes.subarray(entry.payload+8,entry.payload+12)))
            }
            offset=entry.end
        }
    }
    try{
        visit(0,bytes.length,0)
        if(handlers.includes('soun'))return {status:'present',detail:'The new card movie contains an audio track; its microphone level has not been measured.'}
        if(handlers.includes('vide'))return {status:'absent',detail:'The new card movie contains video but no audio track.'}
        throw new Error('Movie metadata did not contain a recognized media track')
    }catch(error){return {status:'unverified',detail:error instanceof Error?error.message:String(error)}}
}
/** Read only headers and bounded movie metadata from a verified card file, without copying its video. */
export async function readCameraMovieAudio(camera:any,file:{handle:number;filename:string;objectCompressedSize:number}):Promise<CameraMovieAudio>{
    try{
        if(!/\.(mp4|mov)$/i.test(file.filename))throw new Error('Audio inspection is available for MP4 and MOV originals')
        const length=file.objectCompressedSize
        if(!Number.isSafeInteger(length)||length<8||length>0xffffffff)throw new Error('Movie size exceeds the bounded audio inspection range')
        const operation=camera.getInstance().registry.operations.GetPartialObject
        const read=async(offset:number,count:number)=>{
            const reply=await camera.send(operation,{ObjectHandle:file.handle,Offset:offset,MaxBytes:count},undefined,count+12)
            if(reply.code!==0x2001||!(reply.data instanceof Uint8Array)||reply.data.length!==count)throw new Error('Camera did not return complete movie metadata')
            return reply.data
        }
        let offset=0
        for(let count=0;offset+8<=length&&count<128;count++){
            const header=await read(offset,8),view=new DataView(header.buffer,header.byteOffset,header.byteLength)
            let size=view.getUint32(0),headerBytes=8
            const type=String.fromCharCode(...header.subarray(4,8))
            if(size===1){const extended=await read(offset+8,8);size=Number(new DataView(extended.buffer,extended.byteOffset,8).getBigUint64(0));headerBytes=16}
            if(size===0)size=length-offset
            if(!Number.isSafeInteger(size)||size<headerBytes||offset+size>length)throw new Error('Invalid original movie atom bounds')
            if(type==='moov'){
                if(headerBytes!==8||size>4*1024*1024)throw new Error('Movie metadata exceeds the bounded inspection limit')
                return inspectMovieTrackHandlers(await read(offset,size))
            }
            offset+=size
        }
        throw new Error('Movie track metadata was not found within the inspection limit')
    }catch(error){return {status:'unverified',detail:error instanceof Error?error.message:String(error)}}
}
