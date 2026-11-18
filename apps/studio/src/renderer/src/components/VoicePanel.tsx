import {
    Button,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Spinner,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@kevinschaich/components'
import { LiveTranscript } from '@renderer/components/LiveTranscript'
import { VoiceBeam } from '@renderer/components/voice-glow'
import {
    AssistantSetupNotice,
    formatDownloadSize,
    ModelLicenseNotice,
    VoiceSetupProgress,
} from '@renderer/components/VoiceSetupProgress'
import type { VoiceEngineStatus } from '@shared/ipc'
import { MICROPHONE_SETTINGS_URL } from '@shared/microphone-errors'
import { summarizeSetup, type SetupSummary } from '@shared/setup-progress'
import { SPEECH_MODELS, type SpeechModelId } from '@shared/speech-models'
import { microphoneLevel, transcriptParagraphs } from '@voice/transcript-store'
import type { LiveTranscription } from '@voice/use-live-transcription'
import { AudioLines, ChevronDown, Download, Eraser, Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface VoicePanelProps {
    voice: LiveTranscription
    expanded: boolean
    onCollapse: () => void
}

const IDLE_VOICE_ENGINE: VoiceEngineStatus = {
    phase: 'idle',
    receivedBytes: 0,
    totalBytes: 0,
    port: null,
    message: null,
    setupStep: null,
    speechModelBytes: 0,
}

/**
 * The library's mobile preset is tuned for a ~400px-wide screen at scale 1.25. `scale` grows heights as well as
 * widths, so it stays fixed here and only the horizontal geometry widens to the panel.
 */
const VOICE_GLOW_REFERENCE_WIDTH = 400
const VOICE_GLOW_PRESET_SCALE = 1.25
const VOICE_GLOW_SCALE = 1.5
const VOICE_GLOW_PRESET_WIDTHS = { rangeWidth: 1.25, glowWidth: 1.15, lobeSpacing: 1.35 }
/** How far the glow fades out before the panel's right edge, where the sidebar begins. */
const VOICE_GLOW_RIGHT_FADE = '12rem'

/**
 * Voice (libraries.dev's voice glow), in its ice palette, across the whole panel, behind its contents and on down behind the status bar
 * to the bottom of the window: it rises and blooms from there with the microphone's level while listening.
 */
function VoiceGlow({ active }: { active: boolean }): React.JSX.Element {
    const ref = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(VOICE_GLOW_REFERENCE_WIDTH)
    // The distance from the panel's bottom to the window's: the status bar's height, more while its log is open.
    const [below, setBelow] = useState(0)
    useEffect(() => {
        const panel = ref.current?.parentElement
        if (!panel) return
        const measure = (): void => {
            const bounds = panel.getBoundingClientRect()
            setWidth(Math.round(bounds.width))
            setBelow(Math.max(0, Math.round(window.innerHeight - bounds.bottom)))
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(panel)
        observer.observe(document.documentElement)
        return () => observer.disconnect()
    }, [])
    const widen = (width / VOICE_GLOW_REFERENCE_WIDTH) * (VOICE_GLOW_PRESET_SCALE / VOICE_GLOW_SCALE)
    const fade = `linear-gradient(to right, black calc(100% - ${VOICE_GLOW_RIGHT_FADE}), transparent)`
    return (
        <div
            ref={ref}
            className="pointer-events-none absolute inset-x-0 top-0"
            style={{ bottom: -below, isolation: 'isolate', maskImage: fade, WebkitMaskImage: fade }}
            aria-hidden
        >
            <VoiceBeam
                type="mobile"
                scale={VOICE_GLOW_SCALE}
                rangeWidth={VOICE_GLOW_PRESET_WIDTHS.rangeWidth * widen}
                glowWidth={VOICE_GLOW_PRESET_WIDTHS.glowWidth * widen}
                lobeSpacing={VOICE_GLOW_PRESET_WIDTHS.lobeSpacing * widen}
                // The library's ice palette as it comes: its own lobe and band colours and colour drift.
                colorVariant="ice"
                active={active}
                // The level the old meter read: the microphone's RMS, lifted so speech fills the range. It is already
                // lifted, so no further gain (the library's default of 3.1 pinned it at full on every syllable).
                level={() => Math.min(1, Math.sqrt(microphoneLevel.get()) * 3.2)}
                sensitivity={1}
                // Quick to rise and fall with each syllable (the library's 0.325s / 0.86s lag behind speech), and
                // a low reach, so it stays near the bottom and only loud speech lifts it.
                attack={0.03}
                release={0.18}
                reach={0.7}
                // The distortion layer is painted only inside a strip sized to the glow's recent height; a sudden
                // rise cuts its warped copy flat, a sliver at the peak. Off, the peak stays smooth.
                distortion={0}
                borderRadius={0}
                style={{ position: 'absolute', inset: 0 }}
            >
                <div className="size-full" />
            </VoiceBeam>
        </div>
    )
}

function MicrophonePicker({ voice }: { voice: LiveTranscription }): React.JSX.Element {
    const items = [
        { value: 'default', label: 'System default' },
        ...voice.microphones
            .filter(microphone => microphone.deviceId !== 'default')
            .map(microphone => ({ value: microphone.deviceId, label: microphone.label })),
    ]
    return (
        <Select
            items={items}
            value={voice.microphoneId}
            onValueChange={value => void voice.chooseMicrophone(String(value))}
        >
            <SelectTrigger size="sm" aria-label="Microphone" className="h-7 max-w-56 min-w-0 gap-1.5 text-xs">
                <Mic className="text-muted-foreground" />
                <SelectValue className="truncate" />
            </SelectTrigger>
            <SelectContent>
                {items.map(item => (
                    <SelectItem key={item.value} value={item.value}>
                        {item.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

function SpeechModelPicker({ voice }: { voice: LiveTranscription }): React.JSX.Element {
    const items = SPEECH_MODELS.map(model => ({ value: model.id, label: model.name }))
    const busy = voice.listening === 'preparing' || voice.listening === 'stopping'
    return (
        <Select
            items={items}
            value={voice.speechModelId}
            disabled={busy}
            onValueChange={value => void voice.chooseSpeechModel(value as SpeechModelId)}
        >
            <SelectTrigger size="sm" aria-label="Speech model" className="h-7 min-w-0 gap-1.5 text-xs">
                <AudioLines className="text-muted-foreground" />
                <SelectValue className="truncate" />
            </SelectTrigger>
            <SelectContent>
                {SPEECH_MODELS.map(model => (
                    <SelectItem key={model.id} value={model.id}>
                        <span className="flex flex-col">
                            <span>{model.name}</span>
                            <span className="text-xs text-muted-foreground">{model.description}</span>
                        </span>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

function EngineMessage({
    voice,
    summary,
}: {
    voice: LiveTranscription
    summary: SetupSummary
}): React.JSX.Element | null {
    const engine = voice.engine
    if (voice.error) {
        return (
            <div className="flex max-w-xl flex-col items-center gap-3 text-center">
                <p className="text-sm text-pretty text-destructive">{voice.error}</p>
                {voice.microphoneBlocked && (
                    <Button size="sm" variant="secondary" onClick={() => window.open(MICROPHONE_SETTINGS_URL)}>
                        Open Microphone Settings
                    </Button>
                )}
            </div>
        )
    }
    const settingUp = engine?.phase === 'downloading' || engine?.phase === 'starting' || voice.listening === 'preparing'
    if (settingUp) {
        return (
            <div className="flex flex-col items-center gap-6">
                <VoiceSetupProgress summary={summary} />
                <ModelLicenseNotice speechModelId={voice.speechModelId} />
            </div>
        )
    }
    if (voice.listening === 'listening') {
        return <p className="text-sm text-muted-foreground">Listening — start speaking</p>
    }
    if (engine?.phase === 'not-downloaded') {
        return (
            <div className="flex flex-col items-center gap-5 text-center">
                <div className="flex flex-col items-center gap-2.5">
                    <p className="text-sm text-pretty">
                        Enabling local voice features requires a one-time download of about{' '}
                        {formatDownloadSize(summary.totalBytes)}.
                    </p>
                    <ModelLicenseNotice speechModelId={voice.speechModelId} />
                </div>
                <Button size="sm" onClick={() => void voice.start()}>
                    <Download /> Set up and start
                </Button>
            </div>
        )
    }
    return <p className="text-sm text-muted-foreground">Press Start to transcribe what you say, live.</p>
}

function ListenButton({ voice }: { voice: LiveTranscription }): React.JSX.Element {
    const busy = voice.listening === 'preparing' || voice.listening === 'stopping'
    if (voice.listening === 'listening' || voice.listening === 'stopping') {
        return (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void voice.stop()}>
                <Square className="fill-current" /> Stop
            </Button>
        )
    }
    return (
        <Button size="sm" disabled={busy} onClick={() => void voice.start()}>
            {busy ? <Spinner /> : <Mic />} Start
        </Button>
    )
}

/** Live transcription, opened from the status bar; grows up from the bottom of the preview column. */
export function VoicePanel({ voice, expanded, onCollapse }: VoicePanelProps): React.JSX.Element {
    const listening = voice.listening === 'listening'
    const paragraphs = transcriptParagraphs.use()
    const hasText = paragraphs.some(paragraph => paragraph.trim())
    const summary = summarizeSetup(voice.engine ?? IDLE_VOICE_ENGINE, voice.assistant)
    return (
        <section
            id="voice-panel"
            className="voice-panel relative shrink-0 border-t border-border bg-black/55"
            data-expanded={expanded}
            aria-label="Voice"
            inert={!expanded}
        >
            <VoiceGlow active={listening && expanded} />
            {/* Clips the panel's contents to its height as it opens; the glow behind them runs on past its bottom. */}
            <div className="absolute inset-0 flex flex-col overflow-hidden">
                <header className="relative flex h-10 shrink-0 items-center gap-2 px-3">
                    <span className="text-sm font-medium">Live transcript</span>
                    <span className="flex-1" />
                    <SpeechModelPicker voice={voice} />
                    <MicrophonePicker voice={voice} />
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label="Clear transcript"
                                    disabled={!hasText}
                                    onClick={voice.clear}
                                />
                            }
                        >
                            <Eraser />
                        </TooltipTrigger>
                        <TooltipContent>Clear transcript</TooltipContent>
                    </Tooltip>
                    <ListenButton voice={voice} />
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button size="icon-sm" variant="ghost" aria-label="Hide voice" onClick={onCollapse} />
                            }
                        >
                            <ChevronDown />
                        </TooltipTrigger>
                        <TooltipContent>Hide</TooltipContent>
                    </Tooltip>
                </header>
                {/* Positioned, so the panel's contents paint above the glow behind them. */}
                <div className="relative flex min-h-0 flex-1 flex-col">
                    {hasText ? (
                        <LiveTranscript paragraphs={paragraphs} listening={listening} />
                    ) : (
                        <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-4">
                            <EngineMessage voice={voice} summary={summary} />
                        </div>
                    )}
                    {hasText && voice.error && (
                        <p className="shrink-0 px-5 pb-2 text-xs text-destructive">{voice.error}</p>
                    )}
                    {listening && <AssistantSetupNotice summary={summary} />}
                </div>
            </div>
        </section>
    )
}

/** The status bar entry that opens the voice panel, with a live dot while listening. */
export function VoiceStatusButton({
    voice,
    expanded,
    onToggle,
}: {
    voice: LiveTranscription
    expanded: boolean
    onToggle: () => void
}): React.JSX.Element {
    const listening = voice.listening === 'listening'
    return (
        <Button variant="ghost" size="xs" onClick={onToggle} aria-expanded={expanded} aria-controls="voice-panel">
            {listening ? <span className="voice-live-dot" aria-hidden /> : <Mic />}
            Voice
            {listening && <span className="text-muted-foreground">Listening</span>}
        </Button>
    )
}
