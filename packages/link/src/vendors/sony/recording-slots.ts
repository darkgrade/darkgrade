/** Read the movie destination without changing the camera's recording-media selection. */
export async function sonyMovieSlots(camera: {getSonyProperty:(name:string)=>Promise<{value:string}>}):Promise<number[]> {
    const selection=await camera.getSonyProperty('Movie_RecordingMedia').catch(()=>undefined)
    if(!selection){
        const secondSlot=await camera.getSonyProperty('MediaSLOT2_Status').catch(()=>undefined)
        if(secondSlot)throw new Error('The camera exposes two card slots but did not report its movie-recording destination; card space cannot be verified')
        return [1]
    }
    const value=Number(selection.value)
    if(value===1 || value===2)return [value]
    if(value===0x101)return [1,2]
    throw new Error('The selected Sony movie-recording media is not supported; check the camera recording-media setting')
}

export async function sonyMovieCard(camera:{getSonyProperty:(name:string)=>Promise<{value:string}>}) {
    const slots=await sonyMovieSlots(camera)
    const cards=await Promise.all(slots.map(async slot=>{
        const status=await camera.getSonyProperty(`MediaSLOT${slot}_Status`)
        const time=await camera.getSonyProperty(`MediaSLOT${slot}_RemainingTime`).catch(()=>undefined)
        const number=await camera.getSonyProperty(`MediaSLOT${slot}_RemainingNumber`).catch(()=>undefined)
        const seconds=Number(time?.value),photos=Number(number?.value)
        const code=Number(status.value)
        return {slot,code,status:code===0?'ready' as const:code===1?'absent' as const:'error' as const,seconds:Number.isFinite(seconds)&&seconds>0&&seconds<0xffffffff?seconds:undefined,photos:Number.isFinite(photos)&&photos>=0&&photos<0xffffffff?photos:undefined}
    }))
    return {
        slot:slots[0]!,slots,
        code:cards.find(card=>card.status==='error')?.code ?? cards.find(card=>card.status==='absent')?.code ?? 0,
        status:cards.some(card=>card.status==='error')?'error' as const:cards.some(card=>card.status==='absent')?'absent' as const:'ready' as const,
        remainingMovieSeconds:cards.every(card=>card.seconds!==undefined)?Math.min(...cards.map(card=>card.seconds!)):undefined,
        remainingPhotos:cards.every(card=>card.photos!==undefined)?Math.min(...cards.map(card=>card.photos!)):undefined,
        source:'Sony Camera Remote SDK',
    }
}
