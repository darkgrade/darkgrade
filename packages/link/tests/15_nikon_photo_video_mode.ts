import { Camera } from '@camera/index'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import {
    ChangeApplicationMode,
    ChangeCameraMode,
    EndMovieRecord,
    StartLiveView,
    StartMovieRecord,
} from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
import {
    LiveViewSelector,
    MovieRecProhibitionCondition,
} from '@ptp/definitions/vendors/nikon/nikon-property-definitions'

const nikonCamera = new Camera({ device: { usb: { filters: [{ vendorId: VendorIDs.NIKON }] } } })
await nikonCamera.connect()

/*
 * NIKON MODES
 *
 * PC CONNECTION NOTES:
 * - Operations by the dials and buttons of the camera body are locked with some exceptions
 * - Captured images are recorded either in the card or in the SDRAM
 * - Image playback & image deletion cannot be performed (except in application mode)
 * - Auto meter-off delay is set to “No limit”
 *
 * MODES
 * - can be changed automatically by the camera when it receives operations
 * - OR manually by using ChangeCameraMode (retained even when command finished)
 *
 * - PC Camera Mode (ChangeCameraMode 0): host commands ignored and uses ones from dial/buttons
 *      - Application Mode ON (ChangeApplicationMode 1): allows image playback, deletion, video recording on the camera
 *      - Application Mode OFF (ChangeApplicationMode 0): disallows image playback, deletion, video recording on the camera
 * - Remote Mode (ChangeCameraMode 1): all dials/buttons ignored
 *      - Photo Mode (LiveViewSelector 0): allows image capture
 *      - Video Mode (LiveViewSelector 1): allows video recording
 */

// await nikonCamera.captureImage()
// await nikonCamera.send(EndLiveView, {})

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Option 1 (FAILED): Camera in photo mode, try entering Applicaiton mode, record
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// await nikonCamera.send(ChangeCameraMode, { Mode: 'PC_CAMERA' })
// await nikonCamera.send(ChangeApplicationMode, { Mode: 'ON' })

// 3:54:21.910 PM [Debug] prohibitionCondition: inPhotoMode (During photo mode)
// const prohibitionCondition = await nikonCamera.get(MovieRecProhibitionCondition)
// console.log('prohibitionCondition:', prohibitionCondition)

// await nikonCamera.send(StartMovieRecord, {})
// await new Promise(resolve => setTimeout(resolve, 5000))
// await nikonCamera.send(EndMovieRecord, {})

// await nikonCamera.send(ChangeApplicationMode, { Mode: 'OFF' })

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Option 2 (FAILED): Remote Mode -> Video Mode -> Start Live View -> Record
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// OK
// await nikonCamera.send(ChangeCameraMode, { Mode: 'REMOTE' })

// OK
// screen turns off, "Connected to computer." message appears
// await nikonCamera.set(LiveViewSelector, 'VIDEO')

// OK, screen still off though
// await nikonCamera.send(StartLiveView, {})

// Not in Application Mode (we can't be??? it needs to be PC Remote mode to switch LiveViewSelector?)
// const prohibitionCondition = await nikonCamera.get(MovieRecProhibitionCondition)
// console.log('prohibitionCondition:', prohibitionCondition)

// await nikonCamera.send(StartMovieRecord, {})
// await new Promise(resolve => setTimeout(resolve, 5000))
// await nikonCamera.send(EndMovieRecord, {})

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Option 3 (FAILED): Remote Mode -> Start Live View -> Video Mode -> Record
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// OK
// await nikonCamera.send(ChangeCameraMode, { Mode: 'REMOTE' })

// OK, screen off
// await nikonCamera.send(StartLiveView, {})

// OK, screen still off
// await nikonCamera.set(LiveViewSelector, 'VIDEO')

// Not in Application Mode (we can't be??? it needs to be PC Remote mode to switch LiveViewSelector?)
// const prohibitionCondition = await nikonCamera.get(MovieRecProhibitionCondition)
// console.log('prohibitionCondition:', prohibitionCondition)

// await nikonCamera.send(StartMovieRecord, {})
// await new Promise(resolve => setTimeout(resolve, 5000))
// await nikonCamera.send(EndMovieRecord, {})

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Option 4 (WORKS, Screen blank): Remote Mode -> Video Mode -> Start Live View -> Application Mode -> Record
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// OK
await nikonCamera.send(ChangeCameraMode, { Mode: 'REMOTE' })

// OK
await nikonCamera.set(LiveViewSelector, 'VIDEO')

// OK
await nikonCamera.send(StartLiveView, {})

// OK
await nikonCamera.send(ChangeApplicationMode, { Mode: 'ON' })

// None, but screen still blank
const prohibitionCondition = await nikonCamera.get(MovieRecProhibitionCondition)
console.log('prohibitionCondition:', prohibitionCondition)

await nikonCamera.send(StartMovieRecord, {})
await new Promise(resolve => setTimeout(resolve, 5000))
await nikonCamera.send(EndMovieRecord, {})

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Option 5 (FAILS): Remote mode -> Video Mode -> Remote Mode -> GetLiveViewSelector
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// await nikonCamera.send(ChangeCameraMode, { Mode: 'REMOTE' }) // OK
// await nikonCamera.set(LiveViewSelector, 'VIDEO') // OK
// await nikonCamera.send(ChangeCameraMode, { Mode: 'PC_CAMERA' }) // OK

// const liveViewSelector = await nikonCamera.get(LiveViewSelector) // PHOTO
// console.log(liveViewSelector)

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Option 6 (FAILS): Remote Mode -> Video Mode -> Start Live View -> Application Mode -> PC Camera Mode -> GetLiveViewSelector
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// await nikonCamera.send(ChangeCameraMode, { Mode: 'REMOTE' })
// await nikonCamera.set(LiveViewSelector, 'VIDEO')
// await nikonCamera.send(StartLiveView, {})
// await nikonCamera.send(ChangeApplicationMode, { Mode: 'ON' })

// let liveViewSelector = await nikonCamera.get(LiveViewSelector)
// console.log(liveViewSelector)

// await nikonCamera.send(ChangeCameraMode, { Mode: 'PC_CAMERA' })
// // now camera is back in photo mode because of the hardware dial :(
// liveViewSelector = await nikonCamera.get(LiveViewSelector)
// console.log(liveViewSelector)

// const prohibitionCondition = await nikonCamera.get(MovieRecProhibitionCondition)
// console.log('prohibitionCondition:', prohibitionCondition)

// await nikonCamera.send(StartMovieRecord, {})
// await new Promise(resolve => setTimeout(resolve, 5000))
// await nikonCamera.send(EndMovieRecord, {})

// await nikonCamera.captureImage()

/** Takeaways:
 * When in Photo Mode, operation StartMovieRecord (0x920A) is not allowed by any means unless in PC Remote Mode (screen blank).
 * When in Video Mode, operations InitiateCapture (0x100E) and InitateCaptureRecInMedia (0x9207) are not allowed by any means unless in PC Remote Mode (screen blank).
 */

await new Promise(resolve => setTimeout(resolve, 2000))
await nikonCamera.disconnect()
