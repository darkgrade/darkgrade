import { cameraService } from '@main/camera-service'
import type { StudioTool, ToolResult } from '@main/tools/studio-tools'
import { visionService, type VisionResult } from '@main/vision/vision-service'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import * as z from 'zod/v4'

const PICTURE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png'])

const pictureInput = {
    imagePath: z
        .string()
        .optional()
        .describe('A JPEG or PNG on this Mac to use instead of the live-view picture (absolute path)'),
}

/** The picture to look at: a JPEG or PNG file when one is named, otherwise the latest live-view frame. */
async function picture(imagePath: unknown): Promise<Uint8Array> {
    if (typeof imagePath === 'string' && imagePath) {
        if (!PICTURE_EXTENSIONS.has(extname(imagePath).toLowerCase())) throw new Error('Name a .jpg or .png file')
        return readFile(imagePath)
    }
    const jpeg = cameraService.latestLiveViewFrame
    if (!jpeg || !cameraService.getState().liveView)
        throw new Error('Live view is off, so there is no picture; start live view or name an imagePath')
    return jpeg
}

function toToolResult({ imagePng, ...data }: VisionResult): ToolResult {
    return { data, image: { base64: imagePng, mimeType: 'image/png' } }
}

/**
 * Developer Mode's vision tools, offered to MCP clients while Developer Mode is on. Each model runs in its own
 * process and stays loaded once used (app menu › Vision Models).
 */
export const VISION_TOOLS: StudioTool[] = [
    {
        name: 'estimate_depth',
        title: 'Estimate depth (Depth Pro 2)',
        description:
            "Apple's Depth Pro 2 on the live-view picture (or a JPEG/PNG file): metric depth in metres for every pixel. Answers the focal length it used, the nearest, median, farthest and centre depth, an 8 x 8 grid of median depths (rows top to bottom), and the depth map as an image (red near, blue far; sky is infinitely far). Pictures are scaled to 1024 pixels on the long side first. Research use only (Apple's model licence).",
        inputSchema: z.object({
            ...pictureInput,
            focalLengthPixels: z
                .number()
                .positive()
                .optional()
                .describe("The lens's focal length in pixels of this picture, when known; otherwise it is estimated"),
        }),
        changesSomething: false,
        run: async input => {
            const image = await picture(input.imagePath)
            const focal = typeof input.focalLengthPixels === 'number' ? input.focalLengthPixels : undefined
            return toToolResult(await visionService.estimateDepth(image, focal))
        },
    },
    {
        name: 'segment_objects',
        title: 'Find and outline objects (SAM 3)',
        description:
            'Meta\'s SAM 3 on the live-view picture (or a JPEG/PNG file): finds every instance of a short noun phrase ("person", "red car", "coffee cup") and outlines it. Answers each instance\'s score, box (fractions of the frame from the top left: left, top, right, bottom) and share of the picture, and the picture with the instances drawn over it.',
        inputSchema: z.object({
            ...pictureInput,
            prompt: z.string().min(1).describe('What to find, as a short noun phrase'),
            threshold: z.number().min(0.1).max(1).default(0.5).describe('Lowest score kept'),
        }),
        changesSomething: false,
        run: async input => {
            const image = await picture(input.imagePath)
            const threshold = typeof input.threshold === 'number' ? input.threshold : 0.5
            return toToolResult(await visionService.segment(image, String(input.prompt), threshold))
        },
    },
]
