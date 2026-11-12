import { Progress, Spinner } from '@kevinschaich/components'
import { modelLicenses } from '@shared/model-licenses'
import type { SetupStep, SetupStepId, SetupSummary } from '@shared/setup-progress'
import type { SpeechModelId } from '@shared/speech-models'
import { Check, Circle } from 'lucide-react'

const WORKING_DESCRIPTIONS: Record<SetupStepId, string> = {
    python: 'Getting the voice engine',
    tools: 'Installing voice tools',
    speech: 'Setting up speech recognition',
    assistant: 'Downloading the assistant',
}

/** Sizes in words a person recognises: whole megabytes below a gigabyte, one decimal above. */
export function formatDownloadSize(bytes: number): string {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
    return `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

function stepDetail(step: SetupStep): string | null {
    if (step.totalBytes > 0)
        return `${formatDownloadSize(step.receivedBytes)} of ${formatDownloadSize(step.totalBytes)}`
    if (step.id === 'tools') return 'This can take a minute or two'
    if (step.id === 'speech') return 'Almost there'
    return null
}

function StepIcon({ step }: { step: SetupStep }): React.JSX.Element {
    if (step.state === 'done') return <Check className="size-3.5 text-live" aria-hidden />
    if (step.state === 'working') return <Spinner className="size-3.5" />
    return <Circle className="size-3.5 text-foreground/25" aria-hidden />
}

function StepList({ steps }: { steps: SetupStep[] }): React.JSX.Element {
    return (
        <ol className="space-y-1.5 text-left text-xs">
            {steps.map(step => (
                <li
                    key={step.id}
                    className={`flex items-center gap-2 ${step.state === 'waiting' ? 'text-muted-foreground' : ''}`}
                    aria-current={step.state === 'working' ? 'step' : undefined}
                >
                    <StepIcon step={step} />
                    <span className="flex-1">{step.label}</span>
                    {step.state === 'done' && <span className="text-muted-foreground">Done</span>}
                </li>
            ))}
        </ol>
    )
}

/** The one-time setup in the voice panel: one bar for everything, the step in progress, and a short checklist. */
export function VoiceSetupProgress({ summary }: { summary: SetupSummary }): React.JSX.Element {
    const { current } = summary
    const detail = current ? stepDetail(current) : null
    return (
        <div className="w-80 space-y-3" role="status" aria-live="polite">
            <div className="space-y-1 text-center">
                <p className="text-sm font-medium">Setting up voice</p>
                <p className="text-xs text-muted-foreground">One time only. Everything stays on this Mac.</p>
            </div>
            <div className="space-y-1.5">
                <Progress value={summary.fraction * 100} aria-label="Voice setup progress" />
                <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="truncate">
                        {current
                            ? `Step ${summary.currentNumber} of ${summary.steps.length} · ${WORKING_DESCRIPTIONS[current.id]}`
                            : 'All set'}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                        {Math.floor(summary.fraction * 100)}%
                    </span>
                </div>
                {detail && <p className="text-xs text-muted-foreground tabular-nums">{detail}</p>}
            </div>
            <StepList steps={summary.steps} />
        </div>
    )
}

/** A quiet line for the assistant's download, which carries on after transcription has already started. */
export function AssistantSetupNotice({ summary }: { summary: SetupSummary }): React.JSX.Element | null {
    const assistant = summary.steps.find(step => step.id === 'assistant')
    if (!assistant || assistant.state !== 'working') return null
    const percent = Math.floor(assistant.fraction * 100)
    return (
        <p className="shrink-0 px-5 pb-2 text-xs text-muted-foreground tabular-nums" role="status">
            Still downloading the assistant ({percent}%). Voice commands start working when it's done.
        </p>
    )
}

/** The terms the person accepts by downloading: a line of notice, then links to the licenses of the models in use. */
export function ModelLicenseNotice({ speechModelId }: { speechModelId: SpeechModelId }): React.JSX.Element {
    const licenses = modelLicenses(speechModelId)
    return (
        <p className="max-w-2xl text-center text-xs leading-relaxed text-balance text-muted-foreground">
            Voice &amp; transcription in Darkgrade Studio use local models that run on your device. By downloading and
            using these models, you agree to the terms of each model&apos;s license:{' '}
            {licenses.map((license, index) => (
                <span key={license.url}>
                    {index > 0 && ', '}
                    <a
                        href={license.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                    >
                        {license.name}
                    </a>
                </span>
            ))}
            .
        </p>
    )
}
