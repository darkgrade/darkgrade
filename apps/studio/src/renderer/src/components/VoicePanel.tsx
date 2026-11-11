import {
    Button,
    Progress,
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
import { microphoneLevel, transcriptParagraphs } from '@voice/transcript-store'
import type { LiveTranscription } from '@voice/use-live-transcription'
import { ChevronDown, Download, Eraser, Mic, Square } from 'lucide-react'

interface VoicePanelProps {
    voice: LiveTranscription
    expanded: boolean
    onCollapse: () => void
}

function formatGigabytes(bytes: number): string {
    return `${(bytes / 1e9).toFixed(1)} GB`
}

const LEVEL_BARS = 5

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
        <Select items={items} value={voice.microphoneId} onValueChange={value => void voice.chooseMicrophone(String(value))}>
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

function EngineMessage({ voice }: { voice: LiveTranscription }): React.JSX.Element | null {
    const engine = voice.engine
    if (voice.error) {
        return <p className="text-sm text-destructive">{voice.error}</p>
    }
    if (engine?.phase === 'downloading') {
        const fraction = engine.totalBytes ? engine.receivedBytes / engine.totalBytes : 0
        return (
            <div className="w-72 space-y-2 text-center">
                <p className="text-sm text-muted-foreground">Downloading the speech model…</p>
                <Progress value={fraction * 100} />
                <p className="text-xs text-muted-foreground tabular-nums">
                    {formatGigabytes(engine.receivedBytes)} of {formatGigabytes(engine.totalBytes)}
                </p>
            </div>
        )
    }
    if (engine?.phase === 'starting' || voice.listening === 'preparing') {
        return (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> Loading the speech model…
            </p>
        )
    }
    if (voice.listening === 'listening') {
        return <p className="text-sm text-muted-foreground">Listening — start speaking</p>
    }
    if (engine?.phase === 'not-downloaded') {
        return (
            <div className="max-w-sm space-y-3 text-center">
                <p className="text-sm text-muted-foreground">
                    Live transcription runs entirely on this Mac. The speech model is a one-time{' '}
                    {formatGigabytes(engine.totalBytes)} download.
                </p>
                <Button size="sm" onClick={() => void voice.start()}>
                    <Download /> Download and start
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
                    <EngineMessage voice={voice} />
                </div>
            )}
            {hasText && voice.error && <p className="shrink-0 px-5 pb-2 text-xs text-destructive">{voice.error}</p>}
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
