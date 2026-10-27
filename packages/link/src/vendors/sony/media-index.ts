import {sonyMovieCard} from '@vendors/sony/recording-slots'

interface RecordingIndexCamera {
    getRecentSonyContents(options:{all:true}):Promise<Record<string,any>[]>
    getSonyProperty(name:string):Promise<{value:string}>
    startRecording():Promise<void>
    stopRecording():Promise<void>
    refreshConnection():Promise<void>
}
const sleep=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds))
export const sonyIndexParseFailure=(error:unknown)=>error instanceof Error&&/SDK code 36102/.test(error.message)
// Pages hold 100 records but repeat their starting cursor, advancing by 99.
// Reserve one upcoming movie as well: 99→100, 198→199, 297→298, …
export const sonyIndexNeedsReserve=(count:number)=>count>=99&&(count%99===0||(count-1)%99===0)

/** Explicit recording-check repair. Never call from a read-only listing or take arming.
 * SDK 2.02 rejects a repeated terminal cursor at a complete page boundary.
 * A bounded maintenance clip advances that cursor without deleting any original.
 */
export async function repairSonyRecordingIndex(camera:RecordingIndexCamera,onRepair?:(attempt:number)=>void){
    let maintenanceRecordings=0
    while(true){
        let contents:Record<string,any>[]|undefined
        try{contents=await camera.getRecentSonyContents({all:true})}
        catch(error){if(!sonyIndexParseFailure(error))throw error}
        if(contents&&!sonyIndexNeedsReserve(contents.length))return {repaired:maintenanceRecordings>0,maintenanceRecordings,contents}
        if(maintenanceRecordings>=2)throw new Error('Sony media index repair did not finish; maintenance recordings stopped after two attempts')
        if((await camera.getSonyProperty('RecordingState')).value!=='0')throw new Error('Stop recording before repairing the Sony media index')
        const card=await sonyMovieCard(camera)
        if(card.status!=='ready'||card.slots.length!==1||card.slot!==1)throw new Error('Sony media index repair requires a usable movie card in slot 1')
        onRepair?.(maintenanceRecordings+1)
        try{
            await camera.startRecording()
            const deadline=Date.now()+5000
            while((await camera.getSonyProperty('RecordingState')).value!=='1'){
                if(Date.now()>=deadline)throw new Error('Camera did not confirm the maintenance recording started')
                await sleep(100)
            }
            await sleep(1000)
        }finally{
            await camera.stopRecording()
            const deadline=Date.now()+15000
            while((await camera.getSonyProperty('RecordingState')).value!=='0'){
                if(Date.now()>=deadline)throw new Error('Maintenance recording stop is unconfirmed; camera connection and power were preserved')
                await sleep(100)
            }
        }
        maintenanceRecordings++
        await camera.refreshConnection()
    }
}
