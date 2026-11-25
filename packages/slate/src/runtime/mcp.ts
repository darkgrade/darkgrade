import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { OperationParameter } from '@camera/operation-table/index'
import { HardwareBusyError } from '@runtime/errors'
import { surfaceOperations, type SurfaceOperation } from '@runtime/operations'
import type { CameraClient, OperationReply } from '@runtime/runtime'

type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

function protect<T extends Record<string, unknown>>(callback: (argumentsValue: T) => Promise<unknown>) {
    return async (argumentsValue: T) => {
        try {
            const result = await callback(argumentsValue)
            const reply = isReply(result) ? result : undefined
            const content: ToolContent[] = [
                {
                    type: 'text',
                    text: typeof result === 'string' ? result : JSON.stringify(reply ? { result: reply.result, files: reply.files } : result, null, 2),
                },
                ...(reply?.images ?? []).map(image => ({ type: 'image' as const, data: image.base64, mimeType: image.mimeType })),
            ]
            return { content }
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

function isReply(value: unknown): value is OperationReply {
    return typeof value === 'object' && value !== null && 'result' in value && 'files' in value
}

function parameterSchema(parameter: OperationParameter): z.ZodType {
    const schema =
        parameter.type === 'number'
            ? z.number()
            : parameter.type === 'switch'
              ? z.boolean()
              : parameter.type === 'choice' && parameter.choices?.length
                ? z.enum(parameter.choices as [string, ...string[]])
                : parameter.name === 'value'
                  ? z.union([z.string().min(1), z.number()])
                  : z.string().min(1)
    const described = schema.describe(parameter.description)
    return parameter.required ? described : described.optional()
}

function toolDescription(operation: SurfaceOperation): string {
    const notes = [
        operation.summary + '.',
        operation.readOnly ? 'Reads only.' : 'Sent once and confirmed by the camera; an unconfirmed command is reported and never resent.',
        ...(operation.immediate ? ['Always allowed: it does not wait behind other camera work.'] : []),
        ...(operation.name.startsWith('set') && operation.name !== 'setClock'
            ? ['Read camera_get_capabilities first: only values in its allowedValues are accepted.']
            : []),
    ]
    return notes.join(' ')
}

/**
 * Registers one tool per public Camera operation, named and described by the operation table:
 * `camera_` + the method in snake_case, one `camera_set_<setting>` tool per typed setting
 * (`camera_get_capabilities` reads them all), plus `camera_discover` and `camera_run_benchmark`.
 */
export function registerCameraTools(server: McpServer, client: CameraClient) {
    for (const operation of surfaceOperations()) {
        if (!operation.mcpTool) continue
        if (operation.name === 'discover') {
            server.registerTool(
                operation.mcpTool,
                {
                    title: 'List attached cameras',
                    description: toolDescription(operation),
                    inputSchema: z.object({}).strict(),
                    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
                },
                protect(async () => client.discover())
            )
            continue
        }
        const shape: Record<string, z.ZodType> = { camera: z.string().min(1).describe('the camera identity the host names') }
        for (const parameter of operation.parameters) shape[parameter.name] = parameterSchema(parameter)
        server.registerTool(
            operation.mcpTool,
            {
                title: operation.summary,
                description: toolDescription(operation),
                inputSchema: z.object(shape).strict(),
                annotations: {
                    readOnlyHint: operation.readOnly,
                    destructiveHint: operation.name === 'takePhoto' || operation.name === 'startRecording',
                    idempotentHint: operation.readOnly,
                    openWorldHint: false,
                },
            },
            protect(async ({ camera, ...input }: Record<string, unknown>) => client.operation(String(camera), operation.name, input))
        )
    }
    if (client.benchmark)
        server.registerTool(
            'camera_run_benchmark',
            {
                title: 'Benchmark and export a camera profile',
                description:
                    'runBenchmark: explicit deep benchmark of an idle camera. Reads advertised operations, events and bounded safe numeric control descriptors, saves a sanitized profile and uploads evidence according to telemetry preferences. Uses host camera ownership; no photos, recording, arbitrary writes or competing sessions. May take three minutes. Partial results are not unsupported features or physical passes.',
                inputSchema: z.object({ camera: z.string().min(1) }).strict(),
                annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
            },
            protect(async ({ camera }: Record<string, unknown>) => client.benchmark!(String(camera)))
        )
}

export function createCameraMcpServer(client: CameraClient) {
    const server = new McpServer(
        { name: 'darkgrade', version: '0.2.0' },
        {
            instructions:
                'One tool per public Camera operation, with the library names. Read camera_get_capabilities before writing: it lists every setting, its allowed values, and which operations the camera can do now. Commands share the owning runtime session and are never resent: an unconfirmed result is reported, so inspect the camera before retrying. A busy camera is not a reason to switch USB or power. camera_stop_recording and camera_stop_zoom are always allowed.',
            capabilities: { tools: {} },
        }
    )
    registerCameraTools(server, client)
    return server
}
