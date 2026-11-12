/** PTP ObjectInfo uses 0xffffffff when the real size needs Nikon's 64-bit query. */
export async function readNikonObjectSize(camera:any,handle:number,reported:number):Promise<number>{
    if(reported!==0xffffffff)return reported
    const operation=camera.getInstance().registry.operations.GetObjectSize
    if(!operation)throw new Error('Nikon large-file size is unavailable; original transfer refused')
    const response=await camera.send(operation,{ObjectHandle:handle})
    const value=response.data
    const size=typeof value==='bigint'||typeof value==='number'?Number(value):NaN
    if(response.code!==0x2001||!Number.isSafeInteger(size)||size<reported)
        throw new Error('Nikon did not confirm the full 64-bit original size; transfer refused')
    return size
}
