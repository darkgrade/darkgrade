import { LlamaServerProcess, llamaServerBinary } from '@main/models/llama-server-process'
import { ModelCache, QWEN_ASSISTANT, totalModelBytes } from '@main/models/model-cache'
import { cameraService } from '@main/camera-service'
import { beginChangeGroup, cameraStatus, endChangeGroup, findTool, STUDIO_TOOLS } from '@main/tools/studio-tools'
import { describeDone, resolveFollowUp } from '@main/assistant/follow-ups'
import { INTENT_GRAMMAR, INTENT_INSTRUCTIONS, parseIntentLine, type FoundRequest } from '@main/assistant/intent-schema'
import { CAMERA_CONTROL_LABELS, IPC_EVENTS, type LocalModelStatus, type LogEntry, type TranscriptSegment, type VoiceIntent } from '@shared/ipc'
import { SHOOTING_GUIDANCE } from '@shared/shooting-guidance'
import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod/v4'

type Broadcast = (channel: string, payload: unknown) => void

/** Each conversation slot's context; the system prompt and tools take about 4k of it. */
const CONTEXT_TOKENS = 16_384
/** One slot finds requests in speech while another carries one out. */
const PARALLEL_REQUESTS = 2
/**
 * Finding requests and carrying them out each keep their own slot, so each slot's long instructions
 * and tool list stay cached between calls instead of being read again every time.
 */
const INTENT_SLOT = 0
const AGENT_SLOT = 1
const MAXIMUM_AGENT_STEPS = 5
const PROGRESS_INTERVAL_MS = 150
/** A request from speech gets this long in all; past it, it's reported as failed and the next one runs. */
const REQUEST_TIMEOUT_MS = 30_000
/** One tool (a camera command) gets this long before it counts as failed. */
const TOOL_TIMEOUT_MS = 12_000

/** Rejects with `message` if `promise` hasn't settled within `milliseconds`. */
function withTimeout<Value>(promise: Promise<Value>, milliseconds: number, message: string): Promise<Value> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

type ChatMessage =
    | { role: 'system' | 'user'; content: string | ChatContent[] }
    | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
    | { role: 'tool'; tool_call_id: string; content: string }
type ChatContent = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
interface ToolCall {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
}

const AGENT_INSTRUCTIONS = `You are the assistant inside Darkgrade Studio, a camera control app on the user's Mac. You control the connected camera with tools. The tools work with any camera: check get_camera_status for what this one offers.

- The camera's current state comes with each request. Act on it directly; call get_camera_status only when you need values after a change.
- Do what the user asks with the fewest tool calls.
- Relative requests use the relative tools: brighter/darker → adjust_exposure ("a little"/"a touch" ≈ 0.33 stops, "a bit" ≈ 0.5, "a lot" ≈ 1–2); warmer/cooler/too blue/too orange → adjust_color_temperature; undo/go back → undo_last_change. Exact values ("f8", "ISO 6400") use set_setting.
- Photos and videos on the card: list_card_files says which is which; "the photo" means a photo, never a video.
- Scopes (histogram, waveform, vectorscope), zebras and focus peaking are Studio's own: use set_studio_view, never the camera display overlay.
- When the user describes how the picture looks ("too bright", "a bit flat"), call analyze_frame first and decide from the numbers. Use get_frame when you need to see the picture itself.
- A QUESTION ("am I clipping?", "is it focused on my eyes?") is answered, not acted on: measure or look, then answer. Change nothing unless they asked you to fix something; at most one refocus for a focus question.
- Only change what was asked or clearly implied. Never take photos, record or download unless asked.
- Finish with one short sentence, at most 15 words, in plain words without raw measurements: what you changed, or what you found. If no tool can do it, say so. Never claim to have done something you didn't.

${SHOOTING_GUIDANCE}`



/** The tool input for a direct action, from the fields the finding step filled in. */
function directInput(request: FoundRequest): Record<string, unknown> {
    switch (request.action) {
        case 'set_setting':
            return { setting: request.setting, value: request.value }
        case 'adjust_exposure':
            return { stops: request.stops, using: request.using ?? 'auto' }
        case 'adjust_color_temperature':
            return { kelvin: request.kelvin }
        case 'set_recording':
            return { recording: request.on }
        case 'zoom':
            return { direction: request.direction }
        case 'set_live_view':
            return { on: request.on }
        case 'set_studio_view':
            return Object.fromEntries(
                Object.entries({
                    scope: request.scope,
                    zebras: request.zebras,
                    zebraLevelPercent: request.zebraLevelPercent,
                    focusPeaking: request.focusPeaking,
                }).filter(([, value]) => value !== undefined)
            )
        default:
            return {}
    }
}

/** A short reply for a direct action, written from its result rather than by the model. */
function describeResult(action: string, data: Record<string, unknown>): string {
    switch (action) {
        case 'set_setting':
            return `${CAMERA_CONTROL_LABELS[data.setting as keyof typeof CAMERA_CONTROL_LABELS] ?? data.setting}: ${data.to}`
        case 'adjust_exposure':
            return `${data.changed} ${data.from} → ${data.to}`
        case 'adjust_color_temperature': {
            const changes = (data.changes as { colorTemperature?: { from: unknown; to: unknown } }[]) ?? []
            const temperature = changes.find(change => change.colorTemperature)?.colorTemperature
            return temperature ? `${temperature.from} K → ${temperature.to} K` : 'Colour temperature changed'
        }
        case 'set_recording':
            return data.recording ? 'Recording' : 'Stopped recording'
        case 'take_photo':
            return `Photo saved: ${data.filename}`
        case 'zoom':
            return `Zoomed to ${(data.lens as { focalLengthMillimetres?: number } | null)?.focalLengthMillimetres ?? '?'} mm`
        case 'autofocus':
            return 'Focused'
        case 'set_live_view':
            return data.liveView ? 'Live view on' : 'Live view off'
        case 'undo_last_change': {
            const restored = (data.restored as { setting: string; to: string }[]) ?? []
            return restored.length ? `Put back ${restored.map(change => `${change.setting} ${change.to}`).join(', ')}` : 'Nothing to undo'
        }
        case 'set_studio_view':
            return 'View updated'
        default:
            return 'Done'
    }
}

const OPENAI_TOOLS = STUDIO_TOOLS.map(tool => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: z.toJSONSchema(tool.inputSchema) },
}))

/** The request-finding prompt. Warm-ups send exactly this for the words so far, so the final call reuses their cache. */
function findingUserText(text: string, context: string, done: string): string {
    return `CAMERA: ${cameraSummary()}\n\nDONE SO FAR (most recent last): ${done || '(nothing yet)'}\n\nEARLIER CONTEXT:\n${context.trim() || '(none)'}\n\nNEW TEXT:\n${text}`
}

/** Words that must appear for an action that's hard to take back. */
const ANCHOR_WORDS: Partial<Record<FoundRequest['action'], RegExp>> = {
    zoom: /\b(zoom|wider|tighter|closer|punch in|push in|pull out)/i,
    take_photo: /\b(photo|still|picture|pic|shot|snap|capture|thumbnail|frame grab)/i,
    set_recording: /\b(roll|record|cut|stop|wrap|rolling|action|go again)/i,
}

/** Placeholder for splitting the chat template around the user's text. */
const TEMPLATE_MARKER = '\u0000USER\u0000'

/** One line on what the camera is doing, so a short command can be read in context. */
function cameraSummary(): string {
    const state = cameraService.getState()
    if (!state.connected) return 'not connected'
    const mode = /movie|s&q/i.test(state.controls?.exposureProgram?.value ?? '') ? 'movie mode' : 'photo mode'
    const controls = state.controls
    const values = (['exposureProgram', 'iso', 'shutterSpeed', 'aperture', 'focusMode', 'focusArea', 'whiteBalance', 'colorTemperature'] as const)
        .map(name => (controls?.[name]?.value ? `${name} ${controls[name]!.value}` : null))
        .filter(Boolean)
    return [mode, state.recording ? 'RECORDING NOW' : 'not recording', state.liveView ? 'live view on' : 'live view off', ...values].join(', ')
}

export interface AgentProgress {
    /** Names this run in the timing log. */
    label?: string
    /** Stops the conversation between steps and cancels a model request in flight. */
    signal?: AbortSignal
    onToolCall?: (name: string, input: unknown) => void
    onToolResult?: (name: string, ok: boolean, data: unknown, durationMs: number) => void
}

/**
 * Studio's local assistant: Qwen3.5 in a private llama-server, the agent loop over Studio's tools,
 * and the step that finds camera requests in live speech. Voice uses it now; a chat window can call
 * runAgent the same way.
 */
class AssistantService {
    private broadcast: Broadcast = () => {}
    private cache = new ModelCache(join(app.getPath('userData'), 'models'))
    private server: LlamaServerProcess | null = null
    private preparing: Promise<number> | null = null
    private status: LocalModelStatus = { phase: 'idle', receivedBytes: 0, totalBytes: 0, port: null, message: null }
    private nextIntentId = 1
    /** Direct actions done for speech, most recent last: what follow-ups refer to, and the model's DONE line. */
    private done: FoundRequest[] = []

    private doneSummary(): string {
        return this.done.map(describeDone).join('; ')
    }
    /** When each request was recognised and when its words were spoken, for the per-request timeline. */
    private recognizedAtMs = new Map<number, { recognizedMs: number; lastWordMs: number }>()
    /** Requests from speech run one at a time, in the order they were said. */
    private intentQueue: Promise<void> = Promise.resolve()

    setBroadcast(broadcast: Broadcast): void {
        this.broadcast = broadcast
    }

    getStatus(): LocalModelStatus {
        if (this.status.phase === 'idle' && !this.cache.isCached(QWEN_ASSISTANT)) {
            return { ...this.status, totalBytes: totalModelBytes(QWEN_ASSISTANT), phase: 'not-downloaded' }
        }
        return this.status
    }

    prepare(): Promise<number> {
        if (this.server?.port) return Promise.resolve(this.server.port)
        this.preparing ??= this.startEngine().finally(() => {
            this.preparing = null
        })
        return this.preparing
    }

    async release(): Promise<void> {
        await this.server?.stop()
        this.server = null
        this.findingTemplate = null
        this.setStatus({ phase: 'idle', port: null, message: null })
    }

    /** Runs a conversation to completion: the model calls tools until it has an answer. */
    async runAgent(messages: ChatMessage[], progress: AgentProgress = {}): Promise<{ reply: string; failed: boolean }> {
        const conversation: ChatMessage[] = [{ role: 'system', content: AGENT_INSTRUCTIONS }, ...messages]
        // A failed attempt the model then fixes ("Movie" → "Movie Manual") isn't a failure; only the last outcome counts.
        let failed = false
        for (let step = 0; step < MAXIMUM_AGENT_STEPS; step++) {
            progress.signal?.throwIfAborted()
            const message = await this.complete(
                { messages: conversation, tools: OPENAI_TOOLS, temperature: 0.2, id_slot: AGENT_SLOT },
                progress.signal,
                `${progress.label ?? 'agent'} step ${step + 1}`
            )
            conversation.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls })
            if (!message.tool_calls?.length) return { reply: (message.content ?? '').trim(), failed }
            for (const call of message.tool_calls) {
                const outcome = await this.runToolCall(call, progress)
                failed = !outcome.ok
                conversation.push({ role: 'tool', tool_call_id: call.id, content: outcome.text })
                if (outcome.image) {
                    conversation.push({
                        role: 'user',
                        content: [
                            { type: 'text', text: `The picture from ${call.function.name}:` },
                            { type: 'image_url', image_url: { url: `data:${outcome.image.mimeType};base64,${outcome.image.base64}` } },
                        ],
                    })
                }
            }
        }
        return { reply: 'That took too many steps, so I stopped.', failed: true }
    }

    private warming = false
    private nextWarmUp: { text: string; context: string } | null = null

    /**
     * Reads the words so far into the finding slot's cache while the speaker is still talking, so
     * the real request at the end of the sentence only has the last word or two left to read.
     * One at a time; newer words replace a queued warm-up.
     */
    warmUp(preview: { text: string; context: string }): void {
        if (!this.server?.port || !this.findingTemplate || !preview.text.trim()) return
        if (this.warming) {
            this.nextWarmUp = preview
            return
        }
        this.warming = true
        // The prompt stops right after the words so far, so the final prompt (more words, then the
        // template's closing) extends it exactly and only the new end has to be read.
        const prompt = this.findingTemplate.before + findingUserText(preview.text, preview.context, this.doneSummary())
        void fetch(`http://127.0.0.1:${this.server.port}/completion`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ prompt, n_predict: 0, id_slot: INTENT_SLOT, cache_prompt: true }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
            .catch(() => {})
            .finally(() => {
                this.warming = false
                const next = this.nextWarmUp
                this.nextWarmUp = null
                if (next) this.warmUp(next)
            })
    }

    /**
     * Looks for camera requests in a stretch of live transcript and carries each one out. Every
     * request is reported as recognised, then done or failed, so the transcript can highlight it.
     */
    async processTranscript(segment: TranscriptSegment): Promise<void> {
        if (!segment.text.trim()) return
        await this.prepare()
        const receivedMs = Date.now()
        this.trace(
            `segment ${segment.segmentId} timing: last word → handed over ${segment.handedOverAtMs - segment.lastWordAtMs} ms, → received ${receivedMs - segment.handedOverAtMs} ms`
        )
        const findingStartedMs = Date.now()
        const quote = segment.text.trim()
        // "Cut." on its own is always the end of a take; the model reads a lone word as a fragment.
        // Handled here, without the model, and taken out of what the model sees so it isn't done twice.
        const sentences = quote.match(/[^.!?]+[.!?]*/g) ?? [quote]
        // Any short sentence that's just "cut" with a word or two around it: "Cut.", "Ah, cut.", "Okay, cut it."
        const isCut = (sentence: string): boolean => /\bcut\b/i.test(sentence) && sentence.trim().split(/\s+/).length <= 3
        const stopWhileRecording = (sentence: string): boolean =>
            cameraService.getState().recording && /^\s*(okay,?\s*)?(that's a wrap|stop recording|stop)[.!]*\s*$/i.test(sentence)
        if (sentences.some(sentence => isCut(sentence) || stopWhileRecording(sentence))) {
            this.trace(`segment ${segment.segmentId} "${quote}" holds a lone cut → record off (no model needed)`)
            this.startRequest(segment, quote, { action: 'set_recording', on: false })
            const rest = sentences.filter(sentence => !isCut(sentence) && !stopWhileRecording(sentence)).join('').trim()
            if (!/[\p{L}\p{N}]/u.test(rest)) return
            segment = { ...segment, text: ` ${rest}` }
        }
        // Follow-ups ("little more", "too far", "undo that", "turn it off") resolve against what was just done.
        const remaining = segment.text.trim()
        const followUp = (remaining.match(/[^.!?]+[.!?]*/g) ?? []).length <= 1 ? resolveFollowUp(remaining, this.done) : null
        if (followUp) {
            this.trace(`segment ${segment.segmentId} "${remaining}" follows up on ${this.doneSummary() || 'nothing'} → ${describeDone(followUp)} (no model needed)`)
            this.startRequest(segment, quote, followUp)
            return
        }
        const lines: string[] = []
        const seen = new Set<string>()
        let directCommands = 0
        // Each answer line runs the moment it's complete, while the model may still be writing the next.
        await this.streamFinding(segment, line => {
            lines.push(line)
            const request = parseIntentLine(line)
            if (!request) return
            // The same request twice in one answer ("way too bright, too far") runs once.
            const key = JSON.stringify({ ...request, instruction: undefined })
            if (seen.has(key)) {
                this.trace(`segment ${segment.segmentId} dropped a duplicate: ${line}`)
                return
            }
            seen.add(key)
            // Actions that are hard to take back need a word for them in what was said; otherwise the
            // model invented them ("way too bright, too far" once added a zoom out).
            const anchor = ANCHOR_WORDS[request.action]
            if (anchor && !anchor.test(segment.text)) {
                this.trace(`segment ${segment.segmentId} dropped ${line}: nothing said asks for it`)
                return
            }
            // A specific exposure setting only when they named it, and never one they said to keep.
            if (request.using) {
                const word = request.using === 'shutterSpeed' ? 'shutter' : request.using
                const named = new RegExp(`\\b${word}`, 'i').test(segment.text)
                const kept = new RegExp(`\\b(keep|leave|don't touch|not)\\b[^.]*\\b${word}`, 'i').test(segment.text)
                if (!named || kept) delete request.using
            }
            // An "ask" after direct commands in the same answer usually just restates them; a question still goes through.
            if (request.action === 'agent' && directCommands > 0 && !request.instruction?.includes('?')) {
                this.trace(`segment ${segment.segmentId} dropped a repeat for the agent: ${line}`)
                return
            }
            if (request.action !== 'agent') directCommands++
            this.trace(`segment ${segment.segmentId} line after ${Date.now() - findingStartedMs} ms: ${line}`)
            this.startRequest(segment, quote, request)
        })
        this.trace(`segment ${segment.segmentId} (${Date.now() - findingStartedMs} ms) ${JSON.stringify(segment.text)} → ${JSON.stringify(lines)}`)
    }

    /**
     * Reads the agent's long instructions and tool list into its slot once at startup, so the first
     * question doesn't spend four seconds on them (the run that measured it read 4,974 tokens cold).
     */
    private async preloadAgentPrompt(port: number): Promise<void> {
        await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                messages: [{ role: 'system', content: AGENT_INSTRUCTIONS }, { role: 'user', content: 'ready' }],
                tools: OPENAI_TOOLS,
                max_tokens: 1,
                id_slot: AGENT_SLOT,
                chat_template_kwargs: { enable_thinking: false },
            }),
        }).catch(() => {})
    }

    /** Shows a request as recognised and queues it: straight to its tool, or to the agent. */
    private startRequest(segment: TranscriptSegment, quote: string, request: FoundRequest): void {
        const intent: VoiceIntent = {
            id: this.nextIntentId++,
            segmentId: segment.segmentId,
            quote,
            instruction: request.instruction ?? quote,
            state: 'recognized',
            reply: null,
        }
        this.recognizedAtMs.set(intent.id, { recognizedMs: Date.now(), lastWordMs: segment.lastWordAtMs })
        this.broadcast(IPC_EVENTS.VoiceIntent, intent)
        this.intentQueue = this.intentQueue.then(() => (request.action === 'agent' ? this.carryOut(intent) : this.carryOutDirectly(intent, request)))
    }

    /** The chat template split around the user's text, read from the server once it starts. */
    private findingTemplate: { before: string; after: string } | null = null

    private async loadFindingTemplate(port: number): Promise<void> {
        const response = await fetch(`http://127.0.0.1:${port}/apply-template`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: INTENT_INSTRUCTIONS },
                    { role: 'user', content: TEMPLATE_MARKER },
                ],
                chat_template_kwargs: { enable_thinking: false },
                add_generation_prompt: true,
            }),
        })
        const { prompt } = (await response.json()) as { prompt: string }
        const [before, after] = prompt.split(TEMPLATE_MARKER)
        this.findingTemplate = { before, after }
    }

    /**
     * Asks the finding model about a stretch of speech, streaming its answer and handing over each
     * complete line as soon as it's written. Logs the server's timings like the other calls.
     */
    private async streamFinding(segment: TranscriptSegment, onLine: (line: string) => void): Promise<void> {
        const port = await this.prepare()
        if (!this.findingTemplate) await this.loadFindingTemplate(port)
        const template = this.findingTemplate!
        const startedMs = Date.now()
        const response = await fetch(`http://127.0.0.1:${port}/completion`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            body: JSON.stringify({
                prompt: template.before + findingUserText(segment.text, segment.context, this.doneSummary()) + template.after,
                grammar: INTENT_GRAMMAR,
                n_predict: 80,
                temperature: 0,
                id_slot: INTENT_SLOT,
                cache_prompt: true,
                stream: true,
            }),
        })
        if (!response.ok || !response.body) throw new Error(`The assistant model failed (HTTP ${response.status})`)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffered = ''
        let answer = ''
        let timings: { prompt_n?: number; prompt_ms?: number; cache_n?: number; predicted_n?: number; predicted_ms?: number } = {}
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffered += decoder.decode(value, { stream: true })
            const events = buffered.split('\n\n')
            buffered = events.pop() ?? ''
            for (const event of events) {
                const data = event.replace(/^data: /, '').trim()
                if (!data.startsWith('{')) continue
                const chunk = JSON.parse(data) as { content?: string; stop?: boolean; timings?: typeof timings }
                if (chunk.timings) timings = chunk.timings
                answer += chunk.content ?? ''
                // A request is complete at its "; " separator or the final newline: run it then.
                let end = answer.search(/[;\n]/)
                while (end >= 0) {
                    const request = answer.slice(0, end).trim()
                    answer = answer.slice(end + 1)
                    if (request && request !== 'none') onLine(request)
                    end = answer.search(/[;\n]/)
                }
            }
        }
        if (answer.trim() && answer.trim() !== 'none') onLine(answer.trim())
        const perSecond = (tokens = 0, milliseconds = 0): string => (milliseconds > 0 ? `${Math.round((tokens / milliseconds) * 1000)} tok/s` : '–')
        this.trace(
            `segment ${segment.segmentId} finding model ${Date.now() - startedMs} ms: ` +
                `input ${timings.prompt_n ?? '?'} new tokens in ${Math.round(timings.prompt_ms ?? 0)} ms (${perSecond(timings.prompt_n, timings.prompt_ms)}), ${timings.cache_n ?? '?'} reused from cache; ` +
                `output ${timings.predicted_n ?? '?'} tokens in ${Math.round(timings.predicted_ms ?? 0)} ms (${perSecond(timings.predicted_n, timings.predicted_ms)})`
        )
    }

    /**
     * A clear command goes straight to its tool: no second model call, and a reply written from the
     * result. If its arguments don't fit the tool, the full agent takes it instead.
     */
    private async carryOutDirectly(intent: VoiceIntent, request: FoundRequest): Promise<void> {
        const tool = findTool(request.action)
        const parsed = tool?.inputSchema.safeParse(directInput(request))
        if (!tool || !parsed?.success) {
            this.trace(`intent ${intent.id} direct ${request.action} didn't fit (${parsed?.error?.message ?? 'no tool'}); asking the agent`)
            return this.carryOut(intent)
        }
        this.broadcast(IPC_EVENTS.VoiceIntent, { ...intent, state: 'running' } satisfies VoiceIntent)
        const startedMs = Date.now()
        const recognized = this.recognizedAtMs.get(intent.id)
        this.recognizedAtMs.delete(intent.id)
        beginChangeGroup()
        try {
            const result = await withTimeout(tool.run(parsed.data as Record<string, unknown>), TOOL_TIMEOUT_MS, `${tool.title} didn't answer in time`)
            const reply = describeResult(tool.name, (result.data ?? {}) as Record<string, unknown>)
            if (request.action === 'undo_last_change') this.done.pop()
            else this.done = [...this.done, request].slice(-5)
            this.trace(`intent ${intent.id} direct ${tool.name} ${JSON.stringify(parsed.data)} (${Date.now() - startedMs} ms): ${reply}`)
            this.broadcast(IPC_EVENTS.VoiceIntent, { ...intent, state: 'done', reply } satisfies VoiceIntent)
        } catch (error) {
            const reply = error instanceof Error ? error.message : String(error)
            this.trace(`intent ${intent.id} direct ${tool.name} failed (${Date.now() - startedMs} ms): ${reply}`)
            this.log(`“${intent.quote}” failed: ${reply}`, 'error')
            this.broadcast(IPC_EVENTS.VoiceIntent, { ...intent, state: 'failed', reply } satisfies VoiceIntent)
        } finally {
            endChangeGroup()
        }
        if (recognized) {
            this.trace(
                `intent ${intent.id} timeline: words spoken → recognised ${recognized.recognizedMs - recognized.lastWordMs} ms → finished ${Date.now() - recognized.lastWordMs} ms (direct)`
            )
        }
    }

    private async carryOut(intent: VoiceIntent): Promise<void> {
        this.broadcast(IPC_EVENTS.VoiceIntent, { ...intent, state: 'running' } satisfies VoiceIntent)
        try {
            const startedMs = Date.now()
            beginChangeGroup()
            const recognized = this.recognizedAtMs.get(intent.id)
            if (recognized) this.trace(`intent ${intent.id} waited ${startedMs - recognized.recognizedMs} ms in the queue`)
            this.trace(`intent ${intent.id} start: ${JSON.stringify(intent.instruction)} (heard ${JSON.stringify(intent.quote)})`)
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(new Error('That took too long, so I stopped')), REQUEST_TIMEOUT_MS)
            const state = `Camera state now: ${JSON.stringify(cameraStatus())}`
            const { reply, failed } = await this.runAgent([{ role: 'user', content: `${intent.instruction}\n\n${state}` }], {
                signal: controller.signal,
                label: `intent ${intent.id}`,
                onToolCall: (name, input) => this.trace(`intent ${intent.id} call ${name} ${JSON.stringify(input)}`),
                onToolResult: (name, ok, data, durationMs) =>
                    this.trace(`intent ${intent.id} ${ok ? 'result' : 'error'} ${name} (${durationMs} ms) ${JSON.stringify(data).slice(0, 400)}`),
            }).finally(() => {
                clearTimeout(timer)
                endChangeGroup()
            })
            this.trace(`intent ${intent.id} ${failed ? 'failed' : 'done'} in ${Date.now() - startedMs} ms: ${reply}`)
            if (recognized) {
                this.trace(
                    `intent ${intent.id} timeline: words spoken → recognised ${recognized.recognizedMs - recognized.lastWordMs} ms → started ${startedMs - recognized.lastWordMs} ms → finished ${Date.now() - recognized.lastWordMs} ms`
                )
                this.recognizedAtMs.delete(intent.id)
            }
            this.log(`“${intent.quote}” → ${reply}`, failed ? 'error' : 'info')
            this.broadcast(IPC_EVENTS.VoiceIntent, { ...intent, state: failed ? 'failed' : 'done', reply } satisfies VoiceIntent)
        } catch (error) {
            const reply = error instanceof Error ? error.message : String(error)
            this.log(`“${intent.quote}” failed: ${reply}`, 'error')
            this.broadcast(IPC_EVENTS.VoiceIntent, { ...intent, state: 'failed', reply } satisfies VoiceIntent)
        }
    }

    private async runToolCall(call: ToolCall, progress: AgentProgress) {
        const tool = findTool(call.function.name)
        if (!tool) return { ok: false, text: `There is no tool called ${call.function.name}` }
        let input: Record<string, unknown>
        try {
            input = tool.inputSchema.parse(JSON.parse(call.function.arguments || '{}')) as Record<string, unknown>
        } catch (error) {
            return { ok: false, text: `Invalid arguments for ${tool.name}: ${error instanceof Error ? error.message : String(error)}` }
        }
        progress.onToolCall?.(tool.name, input)
        const toolStartedMs = Date.now()
        try {
            const result = await withTimeout(tool.run(input), TOOL_TIMEOUT_MS, `${tool.title} didn't answer in time`)
            progress.onToolResult?.(tool.name, true, result.data, Date.now() - toolStartedMs)
            return { ok: true, text: typeof result.data === 'string' ? result.data : JSON.stringify(result.data), image: result.image }
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error)
            progress.onToolResult?.(tool.name, false, text, Date.now() - toolStartedMs)
            return { ok: false, text }
        }
    }

    /**
     * One model call. Logs where its time went, from the server's own numbers: prompt tokens read
     * fresh (slow), reused from the slot's cache (free) and generated.
     */
    private async complete(
        body: Record<string, unknown>,
        signal: AbortSignal | undefined,
        /** Names the call in the timing log; null for warm-ups, which aren't logged. */
        label: string | null
    ): Promise<{ content?: string; tool_calls?: ToolCall[] }> {
        const startedMs = Date.now()
        const port = await this.prepare()
        const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
            method: 'POST',
            signal,
            headers: { 'content-type': 'application/json' },
            // Thinking out loud costs seconds; tool calls and short answers don't need it.
            body: JSON.stringify({ ...body, chat_template_kwargs: { enable_thinking: false } }),
        })
        if (!response.ok) throw new Error(`The assistant model failed (HTTP ${response.status}): ${(await response.text()).slice(0, 200)}`)
        const json = (await response.json()) as {
            choices: { message: { content?: string; tool_calls?: ToolCall[] } }[]
            timings?: { prompt_n?: number; prompt_ms?: number; cache_n?: number; predicted_n?: number; predicted_ms?: number }
        }
        const timings = json.timings ?? {}
        if (label === null) return json.choices[0].message
        const perSecond = (tokens = 0, milliseconds = 0): string => (milliseconds > 0 ? `${Math.round((tokens / milliseconds) * 1000)} tok/s` : '–')
        const totalMs = Date.now() - startedMs
        const modelMs = (timings.prompt_ms ?? 0) + (timings.predicted_ms ?? 0)
        this.trace(
            `${label} model ${totalMs} ms: ` +
                `input ${timings.prompt_n ?? '?'} new tokens in ${Math.round(timings.prompt_ms ?? 0)} ms (${perSecond(timings.prompt_n, timings.prompt_ms)}), ${timings.cache_n ?? '?'} reused from cache; ` +
                `output ${timings.predicted_n ?? '?'} tokens in ${Math.round(timings.predicted_ms ?? 0)} ms (${perSecond(timings.predicted_n, timings.predicted_ms)}); ` +
                `waiting ${Math.max(0, totalMs - Math.round(modelMs))} ms`
        )
        return json.choices[0].message
    }

    private async startEngine(): Promise<number> {
        try {
            if (!this.cache.isCached(QWEN_ASSISTANT)) this.log('Downloading the assistant model (one time)')
            let lastReportMs = 0
            const [modelPath, projectorPath] = await this.cache.ensure(QWEN_ASSISTANT, progress => {
                const now = Date.now()
                if (progress.receivedBytes !== progress.totalBytes && now - lastReportMs < PROGRESS_INTERVAL_MS) return
                lastReportMs = now
                this.setStatus({ phase: 'downloading', ...progress })
            })
            this.setStatus({ phase: 'starting', message: null })
            const server = new LlamaServerProcess({
                binaryPath: llamaServerBinary(),
                modelPath,
                projectorPath,
                contextTokens: CONTEXT_TOKENS,
                parallel: PARALLEL_REQUESTS,
                extraArguments: ['--jinja'],
                // The server's own timings show where seconds go: prompt tokens read vs reused, and generation.
                onLog: line => {
                    if (/prompt eval time|eval time|total time|cache_n|n_past|restored context checkpoint|erased invalidated/i.test(line)) this.trace(`server ${line}`)
                },
                onUnexpectedExit: description => {
                    this.server = null
                    this.log(`The assistant stopped (${description})`, 'error')
                    this.setStatus({ phase: 'error', port: null, message: 'The assistant stopped unexpectedly' })
                },
            })
            const port = await server.start()
            this.server = server
            await this.loadFindingTemplate(port).catch(() => {})
            void this.preloadAgentPrompt(port)
            this.setStatus({ phase: 'ready', port })
            this.log('Assistant ready')
            return port
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            this.log(message, 'error')
            this.setStatus({ phase: 'error', port: null, message })
            throw error
        }
    }

    /** A line in Logs/Darkgrade Studio/assistant.log: what was heard, every tool call and how long it took. */
    private trace(line: string): void {
        try {
            mkdirSync(app.getPath('logs'), { recursive: true })
            appendFileSync(join(app.getPath('logs'), 'assistant.log'), `${new Date().toISOString()} ${line}\n`)
        } catch {
            // Diagnostics only.
        }
    }

    private setStatus(change: Partial<LocalModelStatus>): void {
        this.status = { ...this.status, ...change }
        this.broadcast(IPC_EVENTS.AssistantStatus, this.status)
    }

    private log(message: string, level: LogEntry['level'] = 'info'): void {
        this.broadcast(IPC_EVENTS.Log, { timestampMs: Date.now(), source: 'voice', level, message } satisfies LogEntry)
    }
}

export const assistantService = new AssistantService()
