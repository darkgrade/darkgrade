import type { CameraDriverCapabilities } from '@camera/driver/contract'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'
import { bodyCapability } from '@vendors/capabilities/body'
import { connectionCapability } from '@vendors/capabilities/connection'
import { eventsCapability } from '@vendors/capabilities/events'
import { focusCapability } from '@vendors/capabilities/focus'
import { liveViewCapability } from '@vendors/capabilities/live-view'
import { mediaCapability } from '@vendors/capabilities/media'
import { photoCapability } from '@vendors/capabilities/photo'
import { settingsCapability } from '@vendors/capabilities/settings'
import { videoCapability } from '@vendors/capabilities/video'
import { zoomCapability } from '@vendors/capabilities/zoom'

/** The capability groups this driver provides; one resolver per area, each in its own file. */
export function resolveDriverCapabilities(driver: CameraDriverInstance, owner: Camera): CameraDriverCapabilities {
    return {
        connection: connectionCapability(driver, owner),
        settings: settingsCapability(driver, owner),
        focus: focusCapability(driver, owner),
        zoom: zoomCapability(driver, owner),
        photo: photoCapability(driver, owner),
        liveView: liveViewCapability(driver, owner),
        video: videoCapability(driver, owner),
        media: mediaCapability(driver, owner),
        body: bodyCapability(driver, owner),
        events: eventsCapability(driver, owner),
    }
}
