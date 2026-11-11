import {
    Button,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    ComboboxTrigger,
    Kbd,
    Label,
    Popover,
    PopoverContent,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
    Progress,
    Spinner,
    Switch,
} from '@kevinschaich/components'
import { InspectorSection } from '@renderer/components/InspectorSection'
import { ASR_MODELS, isAsrModelKey } from '@voice/asr-models'
import { VOICE_COMMAND_EXAMPLES } from '@voice/intent-parser'
import { KOKORO_VOICES } from '@voice/speak'
import type { UseVoiceResult } from '@voice/use-voice'
import { ChevronRight, Info, Mic } from 'lucide-react'

interface VoicePanelProps {
    voice: UseVoiceResult
}

function ModelStatus({ voice }: VoicePanelProps): React.JSX.Element | null {
    if (voice.modelStatus === 'loading') {
        return (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Spinner className="size-3" /> Loading
            </span>
        )
    }
    if (voice.modelStatus === 'ready') {
        return <span className="text-xs text-muted-foreground">On-device · {voice.modelDevice}</span>
    }
    if (voice.modelStatus === 'error') return <span className="text-xs text-destructive">Unavailable</span>
    return null
}

function VoiceActivity({ voice }: VoicePanelProps): React.JSX.Element | null {
    if (voice.transcribing) return <p className="text-sm text-muted-foreground">Transcribing…</p>
    if (voice.speaking) return <p className="text-sm text-muted-foreground">Hearing you…</p>
    if (!voice.lastActivity) return null
    return (
        <div className="flex flex-col gap-0.5 rounded-md bg-muted/50 px-3 py-2">
            <p className="text-sm">“{voice.lastActivity.transcript}”</p>
            <p className={`text-xs ${voice.lastActivity.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
                {voice.lastActivity.reply}
            </p>
        </div>
    )
}

export function VoicePanel({ voice }: VoicePanelProps): React.JSX.Element {
    const ready = voice.modelStatus === 'ready'
    const continuous = voice.mode === 'continuous'
    const recognitionOptions = Object.entries(ASR_MODELS).map(([key, config]) => ({ value: key, label: config.label }))
    const setRecognition = (value: string): void => {
        if (isAsrModelKey(value)) voice.setAsrModel(value)
    }
    // Neural voices run on this Mac; system voices come from macOS.
    const replyVoiceOptions = [
        ...(voice.ttsStatus === 'error'
            ? []
            : KOKORO_VOICES.map(option => ({ value: option.id, label: option.label }))),
        ...voice.systemVoices.map(name => ({ value: `system:${name}`, label: `${name} (System)` })),
    ]

    return (
        <InspectorSection title="Voice" collapsible>
            <ModelStatus voice={voice} />
            {voice.modelStatus === 'loading' && (
                <div className="flex flex-col gap-1.5">
                    <Progress value={voice.modelProgress?.progress ?? 0} />
                    <span className="text-xs text-muted-foreground">
                        Downloading {ASR_MODELS[voice.asrModel].label.split(' — ')[1] ?? 'model'} once, then it works
                        offline
                    </span>
                </div>
            )}
            {voice.modelStatus === 'error' && <p className="text-sm text-destructive">{voice.modelError}</p>}
            {voice.micError && <p className="text-sm text-destructive">Microphone: {voice.micError}</p>}

            <Button
                variant={voice.pttActive ? 'default' : 'outline'}
                className="w-full"
                disabled={!ready}
                onPointerDown={voice.startPtt}
                onPointerUp={voice.stopPtt}
                onPointerLeave={() => voice.pttActive && voice.stopPtt()}
            >
                <Mic />
                {voice.pttActive ? 'Listening…' : 'Hold to talk'}
                {!voice.pttActive && <Kbd className="ml-auto">Space</Kbd>}
            </Button>

            <div className="flex items-center justify-between gap-3">
                <Label htmlFor="voice-continuous" className="font-normal">
                    Always listening
                </Label>
                <Switch
                    id="voice-continuous"
                    checked={continuous}
                    disabled={!ready}
                    onCheckedChange={checked => voice.setMode(checked ? 'continuous' : 'off')}
                />
            </div>
            <div className="flex items-center justify-between gap-3">
                <Label htmlFor="voice-wake-word" className="font-normal">
                    Require “Hey Darkgrade”
                </Label>
                <Switch
                    id="voice-wake-word"
                    checked={voice.wakeWordRequired}
                    onCheckedChange={voice.setWakeWordRequired}
                />
            </div>
            <div className="flex items-center justify-between gap-3">
                <Label htmlFor="voice-speak-replies" className="font-normal">
                    Speak replies
                </Label>
                <Switch id="voice-speak-replies" checked={voice.speakReplies} onCheckedChange={voice.setSpeakReplies} />
            </div>

            <VoiceActivity voice={voice} />

            <Popover>
                <PopoverTrigger
                    render={<Button variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground" />}
                >
                    What can I say? <Info aria-hidden />
                </PopoverTrigger>
                <PopoverContent side="left" align="end" className="w-80">
                    <PopoverHeader>
                        <PopoverTitle>Voice commands</PopoverTitle>
                    </PopoverHeader>
                    <ul className="-mx-1 flex max-h-96 flex-col gap-0.5 overflow-y-auto">
                        {VOICE_COMMAND_EXAMPLES.map(example => (
                            <li key={example.phrase} className="rounded-md px-1 py-1.5">
                                <div className="text-sm font-medium">{example.action}</div>
                                <div className="text-xs text-muted-foreground">
                                    {example.phrase.replace(/"([^"]+)"/g, '“$1”')}
                                </div>
                            </li>
                        ))}
                    </ul>
                </PopoverContent>
            </Popover>

            <Collapsible>
                <CollapsibleTrigger className="group flex w-full items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                    <ChevronRight className="size-4 transition group-data-[panel-open]:rotate-90" aria-hidden />
                    Voice settings
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <div className="flex flex-col gap-3 pt-3">
                        <div className="flex min-h-8 items-center justify-between gap-3">
                            <span className="text-muted-foreground">Recognition</span>
                            <Combobox<{ value: string; label: string }>
                                items={recognitionOptions}
                                value={recognitionOptions.find(option => option.value === voice.asrModel) ?? null}
                                disabled={false}
                                itemToStringLabel={option => option.label}
                                itemToStringValue={option => option.value}
                                isItemEqualToValue={(item, current) => item.value === current.value}
                                onValueChange={option => {
                                    if (option && option.value !== voice.asrModel) setRecognition(option.value)
                                }}
                            >
                                <ComboboxTrigger
                                    aria-label="Recognition"
                                    render={
                                        <button
                                            type="button"
                                            className="flex h-7 w-44 items-center justify-between gap-1.5 rounded-md bg-foreground/5 pr-2 pl-2.5 text-sm outline-none hover:bg-foreground/9 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 data-popup-open:bg-foreground/12"
                                        />
                                    }
                                >
                                    <span className="truncate">{ASR_MODELS[voice.asrModel].label.split(' — ')[0]}</span>
                                </ComboboxTrigger>
                                <ComboboxContent className="min-w-72">
                                    <ComboboxInput showTrigger={false} placeholder="Search recognition" />
                                    <ComboboxEmpty>No matches</ComboboxEmpty>
                                    <ComboboxList>
                                        {(option: { value: string; label: string }) => (
                                            <ComboboxItem key={option.value} value={option} className="tabular-nums">
                                                {option.label}
                                            </ComboboxItem>
                                        )}
                                    </ComboboxList>
                                </ComboboxContent>
                            </Combobox>
                        </div>
                        <div className="flex min-h-8 items-center justify-between gap-3">
                            <span className="text-muted-foreground">Reply voice</span>
                            <Combobox<{ value: string; label: string }>
                                items={replyVoiceOptions}
                                value={replyVoiceOptions.find(option => option.value === voice.ttsVoice) ?? null}
                                disabled={false}
                                itemToStringLabel={option => option.label}
                                itemToStringValue={option => option.value}
                                isItemEqualToValue={(item, current) => item.value === current.value}
                                onValueChange={option => {
                                    if (option && option.value !== voice.ttsVoice) voice.setTtsVoice(option.value)
                                }}
                            >
                                <ComboboxTrigger
                                    aria-label="Reply voice"
                                    render={
                                        <button
                                            type="button"
                                            className="flex h-7 w-44 items-center justify-between gap-1.5 rounded-md bg-foreground/5 pr-2 pl-2.5 text-sm outline-none hover:bg-foreground/9 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 data-popup-open:bg-foreground/12"
                                        />
                                    }
                                >
                                    <span className="truncate">
                                        {replyVoiceOptions.find(option => option.value === voice.ttsVoice)?.label ??
                                            'Default'}
                                    </span>
                                </ComboboxTrigger>
                                <ComboboxContent className="min-w-60">
                                    <ComboboxInput showTrigger={false} placeholder="Search reply voice" />
                                    <ComboboxEmpty>No matches</ComboboxEmpty>
                                    <ComboboxList>
                                        {(option: { value: string; label: string }) => (
                                            <ComboboxItem key={option.value} value={option} className="tabular-nums">
                                                {option.label}
                                            </ComboboxItem>
                                        )}
                                    </ComboboxList>
                                </ComboboxContent>
                            </Combobox>
                        </div>
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </InspectorSection>
    )
}
