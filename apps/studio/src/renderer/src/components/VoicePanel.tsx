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

interface VoicePanelProps {
    voice: LiveTranscription
    expanded: boolean
    onCollapse: () => void
}

const LEVEL_BARS = 5

const IDLE_VOICE_ENGINE: VoiceEngineStatus = {
    phase: 'idle',
    receivedBytes: 0,
    totalBytes: 0,
    port: null,
    message: null,
    setupStep: null,
    speechModelBytes: 0,
}

/** A small meter that shows the microphone is hearing you. */
function LevelMeter({ active }: { active: boolean }): React.JSX.Element {
    const level = microphoneLevel.use()
    const loudness = Math.min(1, Math.sqrt(level) * 3.2)
    return (
        <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
            {Array.from({ length: LEVEL_BARS }, (_, index) => {
                const lit = active && loudness * LEVEL_BARS > index
                return (
                    <span
                        key={index}
                        className={`w-[3px] rounded-full transition-[height,background-color] duration-100 ${lit ? 'bg-live' : 'bg-foreground/15'}`}
                        style={{ height: `${30 + index * 17}%` }}
                    />
                )
            })}
        </span>
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
            className="voice-panel flex shrink-0 flex-col overflow-hidden border-t border-border bg-black/55"
            data-expanded={expanded}
            aria-label="Voice"
            inert={!expanded}
        >
            <header className="flex h-10 shrink-0 items-center gap-2 px-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                    Live transcript
                    <LevelMeter active={listening} />
                </span>
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
                        render={<Button size="icon-sm" variant="ghost" aria-label="Hide voice" onClick={onCollapse} />}
                    >
                        <ChevronDown />
                    </TooltipTrigger>
                    <TooltipContent>Hide</TooltipContent>
                </Tooltip>
            </header>
            {hasText ? (
                <LiveTranscript paragraphs={paragraphs} listening={listening} />
            ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-4">
                    <EngineMessage voice={voice} summary={summary} />
                </div>
            )}
            {hasText && voice.error && <p className="shrink-0 px-5 pb-2 text-xs text-destructive">{voice.error}</p>}
            {listening && <AssistantSetupNotice summary={summary} />}
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
