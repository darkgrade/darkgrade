import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { HardwareBusyError } from '@runtime/errors'
import { surfaceOperations, type OperationParameter, type SurfaceOperation } from '@runtime/operations'
import type { CameraClient, OperationReply } from '@runtime/runtime'

type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

function protect<T extends Record<string, unknown>>(callback: (argumentsValue: T) => Promise<unknown>) {
    return async (argumentsValue: T) => {
        try {
            const result = await callback(argumentsValue)
            const reply = isReply(result) ? result : undefined
            const text = typeof result === 'string' ? result : JSON.stringify(reply ? { result: reply.result, files: reply.files } : result, null, 2)
            const images = (reply?.images ?? []).map(image => ({ type: 'image' as const, data: image.base64, mimeType: image.mimeType }))
            const content: ToolContent[] = [{ type: 'text', text }, ...images]
            return { content }
        } catch (error) {
            return toolError(error)
        }
    }
}

/** An MCP tool's error result; a busy camera keeps its code and retry hint for the client. */
export function toolError(error: unknown) {
    return {
        isError: true,
        ...(error instanceof HardwareBusyError && {
            structuredContent: {
                error: error.message,
                code: error.code,
                busy: true,
                retryAfterMilliseconds: error.retryAfterMilliseconds,
            },
        }),
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
    }
}

function isReply(value: unknown): value is OperationReply {
    return typeof value === 'object' && value !== null && 'result' in value && 'files' in value
}

function parameterSchema(parameter: OperationParameter): z.ZodType {
    const [first, ...rest] = parameter.choices ?? []
    const schema =
        parameter.type === 'number'
            ? z.number()
            : parameter.type === 'switch'
              ? z.boolean()
              : parameter.type === 'choice' && first !== undefined
                ? z.enum([first, ...rest])
                : parameter.type === 'text'
                  ? z.union([z.string().min(1), z.number()])
                  : z.string().min(1)
    const described = schema.describe(parameter.description)
    return parameter.required ? described : described.optional()
}

function toolDescription(operation: SurfaceOperation): string {
    return [
        operation.summary + '.',
        operation.readOnly ? 'Reads only.' : 'Sent once and confirmed by the camera; an unconfirmed command is reported and never resent.',
        ...(operation.immediate ? ['Always allowed: it does not wait behind other camera work.'] : []),
        ...(/^set(?!Clock|FocusPoint)[A-Z]/.test(operation.name)
            ? ['Read camera_get_capabilities first: only values in its allowedValues are accepted.']
            : []),
    ].join(' ')
}

/** One generated camera tool: its MCP name, schema and annotations, and the operation it runs. */
export interface CameraToolDefinition {
    name: string
    title: string
    description: string
    inputSchema: z.ZodObject
    annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: false }
    operation: SurfaceOperation
}

/**
 * One tool per public Camera operation, named and described from Camera itself: `camera_` + the
 * method in snake_case, with the method's inputs. Hosts that hold one camera (Studio) pass
 * `cameraArgument: false`; the runtime's tools take the camera identity the host names.
 */
export function cameraToolDefinitions(options: { cameraArgument?: boolean } = {}): CameraToolDefinition[] {
    return surfaceOperations().map(operation => {
        const named = options.cameraArgument !== false && !operation.static
        const shape: Record<string, z.ZodType> = named ? { camera: z.string().min(1).describe('the camera identity the host names') } : {}
        for (const parameter of operation.parameters) shape[parameter.name] = parameterSchema(parameter)
        return {
            name: operation.mcpTool,
            title: operation.summary,
            description: toolDescription(operation),
            inputSchema: z.object(shape).strict(),
            annotations: {
                readOnlyHint: operation.readOnly,
                destructiveHint: operation.name === 'takePhoto' || operation.name === 'startRecording',
                idempotentHint: operation.readOnly,
                openWorldHint: false,
            },
            operation,
        }
    })
}

/** Registers the generated camera tools, plus `camera_run_benchmark` where the host offers it. */
export function registerCameraTools(server: McpServer, client: CameraClient) {
    for (const tool of cameraToolDefinitions()) {
        const { name, operation, ...config } = tool
        const run = async ({ camera, ...input }: Record<string, unknown>) =>
            operation.static ? client.discover() : client.operation(String(camera), operation.name, input)
        server.registerTool(name, config, protect(run))
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
            instructions: 'One tool per public Camera operation, with the library names and results. Read camera_get_capabilities before writing: it lists every setting, its allowed values, and which operations the camera can do now. Commands share the owning runtime session and are never resent: an unconfirmed result is reported, so inspect the camera before retrying. A busy camera is not a reason to switch USB or power. camera_stop_recording and camera_stop_zoom are always allowed.',
            capabilities: { tools: {} },
        }
    )
    registerCameraTools(server, client)
    return server
}
