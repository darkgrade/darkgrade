import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { HardwareBusyError } from './errors.ts'
import type { CameraClient } from './runtime.ts'

function protect<T extends Record<string, unknown>>(callback: (argumentsValue: T) => Promise<unknown>) {
    return async (argumentsValue: T) => {
        try {
            const result = await callback(argumentsValue)
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                    },
                ],
            }
        } catch (error) {
            return {
                isError: true,
                ...(error instanceof HardwareBusyError
                    ? {
                          structuredContent: {
                              error: error.message,
                              code: error.code,
                              busy: true,
                              retryAfterMilliseconds: error.retryAfterMilliseconds,
                          },
                      }
                    : {}),
                content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
            }
        }
    }
}
/** Register identical camera tools in a standalone Darkgrade server or a compatibility host. */
export function registerCameraTools(server: McpServer, client: CameraClient) {
    server.registerTool(
        'camera_take_photo',
        {
            title: 'Take a photo through Darkgrade',
            description:
                'Capture one photo using the active USB or Wi-Fi transport. Sony Wi-Fi captures and downloads completed photo files, returning validated metadata and download URLs, and shares an open Console session. USB captures write to the camera card. Camera writes temporarily block power/USB recovery.',
            inputSchema: z.object({ camera: z.string().min(1) }),
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        },
        protect(async ({ camera }) => client.media(camera as string, 'take-photo'))
    )

    server.registerTool(
        'camera_storage',
        {
            title: 'Read camera card capacity',
            description:
                'Read populated card slots, capacity and recording access over native USB or Nikon Wi-Fi. For Sony SDK Wi-Fi, use camera_sony_wifi_capabilities with query MediaSLOT to inspect current card telemetry. Does not take a photo or delete media.',
            inputSchema: z.object({ camera: z.string().min(1) }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        protect(async ({ camera }) => client.media(camera as string, 'storage'))
    )

    server.registerTool(
        'camera_nikon_memory_status',
        {
            title: 'Inspect pending Nikon memory photos',
            description:
                'Peek at retained Nikon SDRAM image events and read their object metadata over the active USB or Wi-Fi link. Does not drain the event queue, release the shutter, download images, delete media or change connection.',
            inputSchema: z.object({ camera: z.string().min(1) }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        protect(async ({ camera }) => client.media(camera as string, 'memory-status'))
    )

    server.registerTool(
        'camera_download_latest_photo',
        {
            title: 'Download the latest camera photo',
            description:
                'Follow the camera’s active USB or Wi-Fi transport, locate its newest image through Darkgrade, and download it to the bounded bench media cache. Sony Wi-Fi uses SDK RemoteTransfer and verifies the received file size against the camera. Returns filename, byte count, object handle, and local path.',
            inputSchema: z.object({ camera: z.string().min(1) }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        },
        protect(async ({ camera }) => client.media(camera as string, 'latest-photo'))
    )

    server.registerTool(
        'camera_live_view_frame',
        {
            title: 'Read one live-view frame',
            description:
                'Follow the active USB or Wi-Fi transport and request one live-view JPEG through Darkgrade. Vendor support varies; unsupported cameras return a clear error. The frame is saved in the bounded bench media cache.',
            inputSchema: z.object({ camera: z.string().min(1) }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        },
        protect(async ({ camera }) => client.media(camera as string, 'live-view'))
    )

    server.registerTool(
        'camera_controls',
        {
            title: 'Read attached camera controls',
            description:
                'Open a bounded Darkgrade session and return camera-advertised values, choices, and live availability. Supports Canon EOS, Sony, and capability-driven standard PTP controls on Nikon and Olympus bodies. A standard control is returned only when the attached body and current transport advertise it.',
            inputSchema: z.object({ camera: z.string().min(1) }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        protect(async ({ camera }) => client.control(camera as string, 'status'))
    )

    server.registerTool(
        'camera_autofocus',
        {
            title: 'Autofocus a camera',
            description:
                'Drive Canon EOS, Sony or Nikon autofocus without taking a picture. Nikon returns fresh camera-reported focus status separately from command acceptance. Darkgrade always bounds the focus hold and releases the remote half-press.',
            inputSchema: z.object({ camera: z.string().min(1) }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        },
        protect(async ({ camera }) => client.control(camera as string, 'autofocus'))
    )

    server.registerTool(
        'camera_set_focus_mode',
        {
            title: 'Set camera focus mode',
            description:
                'Set a focus mode advertised by the attached Canon, Sony, Nikon, or Olympus camera and return the resulting control state.',
            inputSchema: z.object({
                camera: z.string().min(1),
                mode: z.string().min(1),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        protect(async ({ camera, mode }) => client.control(camera as string, 'set-focus-mode', mode as string))
    )

    server.registerTool(
        'camera_set_white_balance',
        {
            title: 'Set camera white balance',
            description:
                'Set a white-balance value advertised and currently enabled by the attached Canon, Sony, Nikon, or Olympus camera.',
            inputSchema: z.object({
                camera: z.string().min(1),
                whiteBalance: z.string().min(1),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        protect(async ({ camera, whiteBalance }) =>
            client.control(camera as string, 'set-white-balance', whiteBalance as string)
        )
    )

    server.registerTool(
        'camera_set_manual_exposure',
        {
            title: 'Enable camera Manual exposure',
            description:
                'Switch a Canon EOS, Sony or Nikon camera to an advertised Manual exposure mode, verify readback and refresh exposure controls. Retains the mode for subsequent commands.',
            inputSchema: z.object({ camera: z.string().min(1) }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        protect(({ camera }) => client.control(camera as string, 'set-exposure-mode', 'manual'))
    )

    for (const [name, title, action] of [
        ['camera_set_aperture', 'Set camera aperture', 'set-aperture'],
        ['camera_set_shutter_speed', 'Set camera shutter speed', 'set-shutter-speed'],
        ['camera_set_iso', 'Set camera ISO', 'set-iso'],
    ] as const) {
        server.registerTool(
            name,
            {
                title,
                description: `Set a value currently advertised and enabled by the attached camera over its active USB or supported Wi-Fi connection. Read camera_controls first; mode-dependent display-only values are rejected clearly.`,
                inputSchema: z.object({ camera: z.string().min(1), value: z.string().min(1) }),
                annotations: {
                    readOnlyHint: false,
                    destructiveHint: false,
                    idempotentHint: true,
                    openWorldHint: false,
                },
            },
            protect(async ({ camera, value }) => client.control(camera as string, action, value as string))
        )
    }

    server.registerTool(
        'camera_set_movie_format',
        {
            title: 'Set camera movie recording format',
            description:
                'Set a complete Canon record key or Sony movie codec/container name returned by camera_controls. The body must advertise the value in the current mode.',
            inputSchema: z.object({ camera: z.string().min(1), formatKey: z.string().min(1) }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        protect(async ({ camera, formatKey }) =>
            client.control(camera as string, 'set-movie-format', formatKey as string)
        )
    )
}
export function createCameraMcpServer(client: CameraClient) {
    const server = new McpServer(
        { name: 'darkgrade', version: '0.1.0' },
        {
            instructions:
                'Camera controls and media follow the active transport. Read camera_controls before writing. Commands share the owning runtime session. A busy camera is not a reason to switch USB or power. A timed-out write may still be running; inspect the host before retrying.',
            capabilities: { tools: {} },
        }
    )
    registerCameraTools(server, client)
    return server
}
