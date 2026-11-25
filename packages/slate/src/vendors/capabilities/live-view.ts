import { CanonCamera } from '@camera/canon-camera'
import type { OperationSupport } from '@camera/controls'
import type { FocusFrame, LiveViewCapability, LiveViewFrame } from '@camera/driver/live-view'
import { CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { NikonCamera, type NikonLiveViewMetadata } from '@camera/nikon-camera'
import { cameraContext, type CameraDriverInstance } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'
import type { Logger } from '@core/logger'

/** After this long without an overlay request, the next frame switches the camera's overlay output off. */
export const OVERLAY_IDLE_MILLISECONDS = 2_000

const overlayUnsupported = 'This camera does not send its on-screen display'

function requireImage(data: Uint8Array | undefined): Uint8Array {
    if (!data?.length) throw new Error('The camera returned no live-view image')
    return data
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

/**
 * Sony live view: waits for the camera's next frame before asking (pacing, measured by the driver),
 * so a caller never polls in a tight loop, and the frame request itself is one transaction. The
 * on-screen display output is switched on by the first overlay request and off once overlays stop.
 */
class SonyLiveView implements LiveViewCapability {
    /** True until the camera confirms its overlay output is off. */
    private overlayOutput = false
    /** When the output may next be switched off: an idle interval after the last overlay request or failed attempt. */
    private switchOffDueMs = 0

    constructor(
        private readonly driver: SonyCamera,
        private readonly logger: Logger
    ) {}

    support(): Record<'getLiveViewFrame', OperationSupport> {
        const states = this.driver.listPropertyStates()
        const status = states.find(state => state.name === 'LiveViewStatus')?.value
        const overlay: OperationSupport = states.some(state => state.name === 'OsdImageMode')
            ? { supported: true }
            : { supported: false, reason: overlayUnsupported }
        if (status === 'NOT_SUPPORTED')
            return {
                getLiveViewFrame: {
                    supported: false,
                    reason: 'The camera reports live view unavailable in its current mode',
                    options: { overlay },
                },
            }
        return { getLiveViewFrame: { supported: true, options: { overlay } } }
    }

    async getLiveViewFrame({ overlay }: { overlay: boolean }): Promise<LiveViewFrame> {
        const untilNextFrameMilliseconds = this.driver.millisecondsUntilNextLiveViewFrame()
        if (untilNextFrameMilliseconds > 0) await wait(untilNextFrameMilliseconds)
        let frame: Awaited<ReturnType<SonyCamera['captureLiveView']>>
        try {
            frame = await this.driver.captureLiveView({ includeInfo: false })
        } catch (error) {
            if (error instanceof Error && /unavailable in the current camera mode/.test(error.message))
                throw new CameraUnsupportedError('getLiveViewFrame', error.message)
            throw error
        }
        const focusFrames: FocusFrame[] = (frame.sonyFocalFrames ?? []).map(
            ({ kind, focused, centerX, centerY, width, height }) => ({ kind, focused, centerX, centerY, width, height })
        )
        const jpeg = requireImage(frame.data)
        if (overlay) return { jpeg, focusFrames, overlay: await this.readOverlay() }
        if (this.overlayOutput && Date.now() > this.switchOffDueMs) await this.switchOverlayOutputOff()
        return { jpeg, focusFrames }
    }

    /**
     * The frame already read is never lost to this: a failed or unconfirmed switch-off is logged
     * and tried again on a frame one idle interval later.
     */
    private async switchOverlayOutputOff(): Promise<void> {
        try {
            await this.driver.setOsdImageMode(false)
            this.overlayOutput = false
        } catch (error) {
            this.switchOffDueMs = Date.now() + OVERLAY_IDLE_MILLISECONDS
            this.logger.addLog({
                type: 'console',
                level: 'warn',
                consoleLevel: 'warn',
                args: [
                    `Switching the camera's overlay output off was not confirmed; trying again later: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                ],
            })
        }
    }

    private async readOverlay(): Promise<{ png: Uint8Array }> {
        if (!this.driver.listPropertyStates().some(state => state.name === 'OsdImageMode'))
            throw new CameraUnsupportedError('getLiveViewFrame', overlayUnsupported)
        this.switchOffDueMs = Date.now() + OVERLAY_IDLE_MILLISECONDS
        this.overlayOutput = true
        const { image } = await this.driver.captureOsdImage()
        return { png: image }
    }
}

/** Nikon's AF frame, normalized over the displayed area so it lines up with the picture when magnified. */
function nikonFocusFrames(metadata: NikonLiveViewMetadata | undefined): FocusFrame[] {
    if (!metadata) return []
    const { afFrameCenterCoords: center, afFrameSize: size, displayAreaSize, displayCenterCoords, wholeSize } = metadata
    const display =
        displayAreaSize?.horizontal > 0 && displayAreaSize.vertical > 0 && displayCenterCoords
            ? {
                  left: displayCenterCoords.horizontal - displayAreaSize.horizontal / 2,
                  top: displayCenterCoords.vertical - displayAreaSize.vertical / 2,
                  width: displayAreaSize.horizontal,
                  height: displayAreaSize.vertical,
              }
            : wholeSize?.horizontal > 0 && wholeSize.vertical > 0
              ? { left: 0, top: 0, width: wholeSize.horizontal, height: wholeSize.vertical }
              : undefined
    if (!display || !center || !size || size.horizontal <= 0 || size.vertical <= 0) return []
    return [
        {
            kind: 'focus',
            // Nikon focusing judgement: 0 no information, 1 not focused, 2 focused.
            focused: metadata.focusingJudgementResult === 2,
            centerX: (center.horizontal - display.left) / display.width,
            centerY: (center.vertical - display.top) / display.height,
            width: size.horizontal / display.width,
            height: size.vertical / display.height,
        },
    ]
}

function nikonLiveView(driver: NikonCamera): LiveViewCapability {
    return {
        support: () => ({
            getLiveViewFrame: {
                supported: true,
                options: { overlay: { supported: false, reason: overlayUnsupported } },
            },
        }),
        async getLiveViewFrame({ overlay }) {
            if (overlay) throw new CameraUnsupportedError('getLiveViewFrame', overlayUnsupported)
            const frame = await driver.captureLiveView({ includeInfo: false })
            return { jpeg: requireImage(frame.data), focusFrames: nikonFocusFrames(frame.nikonMetadata) }
        },
    }
}

/** Canon's viewfinder frames carry no focus frames Slate decodes yet; none is invented. */
function canonLiveView(driver: CanonCamera): LiveViewCapability {
    return {
        support: () => ({
            getLiveViewFrame: {
                supported: true,
                options: { overlay: { supported: false, reason: overlayUnsupported } },
            },
        }),
        async getLiveViewFrame({ overlay }) {
            if (overlay) throw new CameraUnsupportedError('getLiveViewFrame', overlayUnsupported)
            const frame = await driver.captureLiveView({ includeData: true })
            return { jpeg: requireImage(frame.data), focusFrames: [] }
        },
    }
}

/**
 * Each vendor's live view, or undefined when the driver has none (standard PTP has no live-view
 * operation, so generic and other vendor-extension bodies report it unsupported).
 */
export function liveViewCapability(driver: CameraDriverInstance, owner: Camera): LiveViewCapability | undefined {
    if (driver instanceof SonyCamera) return new SonyLiveView(driver, cameraContext(owner).logger)
    if (driver instanceof NikonCamera) return nikonLiveView(driver)
    if (driver instanceof CanonCamera) return canonLiveView(driver)
    return undefined
}
