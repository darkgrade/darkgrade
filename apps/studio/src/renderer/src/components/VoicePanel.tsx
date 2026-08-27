import { ASR_MODELS, isAsrModelKey } from '@voice/asr-models'
import { VOICE_COMMAND_EXAMPLES } from '@voice/intent-parser'
import { KOKORO_VOICES } from '@voice/speak'
import type { UseVoiceResult } from '@voice/use-voice'
import { useState } from 'react'

interface VoicePanelProps {
    voice: UseVoiceResult
}

export function VoicePanel({ voice }: VoicePanelProps): React.JSX.Element {
    const [showCommands, setShowCommands] = useState(false)

    return (
        <div className="panel voice-panel">
            <div className="panel-header">
                <h2>Voice control</h2>
                <span className={`voice-model-status voice-model-${voice.modelStatus}`}>
                    {voice.modelStatus === 'loading' && 'loading model…'}
                    {voice.modelStatus === 'ready' && `local · ${voice.modelDevice}`}
                    {voice.modelStatus === 'error' && 'model error'}
                </span>
            </div>

            {voice.modelStatus === 'loading' && (
                <div className="voice-progress">
                    <div className="download-progress">
                        <div
                            className="download-progress-bar"
                            style={{ width: `${voice.modelProgress?.progress ?? 0}%` }}
                        />
                        <span className="download-progress-text">
                            {ASR_MODELS[voice.asrModel].label} — downloads once, then cached offline
                        </span>
                    </div>
                </div>
            )}
            {voice.modelStatus === 'error' && <div className="voice-error">{voice.modelError}</div>}
            {voice.micError && <div className="voice-error">Mic: {voice.micError}</div>}

            <div className="voice-controls">
                <button
                    className={`button ptt-button ${voice.pttActive ? 'ptt-active' : ''}`}
                    disabled={voice.modelStatus !== 'ready'}
                    onMouseDown={voice.startPtt}
                    onMouseUp={voice.stopPtt}
                    onMouseLeave={() => voice.pttActive && voice.stopPtt()}
                >
                    {voice.pttActive ? '● Listening…' : '🎙 Hold to talk (Space)'}
                </button>
                <button
                    className={`button ${voice.mode === 'continuous' ? 'button-primary' : ''}`}
                    disabled={voice.modelStatus !== 'ready'}
                    onClick={() => voice.setMode(voice.mode === 'continuous' ? 'off' : 'continuous')}
                >
                    {voice.mode === 'continuous' ? 'Always listening: ON' : 'Always listening: OFF'}
                </button>
            </div>

            <div className="voice-options">
                <label className="checkbox">
                    <input
                        type="checkbox"
                        checked={voice.wakeWordRequired}
                        onChange={event => voice.setWakeWordRequired(event.target.checked)}
                    />
                    Require “hey darkgrade” prefix when always listening
                </label>
                <label className="checkbox">
                    <input
                        type="checkbox"
                        checked={voice.speakReplies}
                        onChange={event => voice.setSpeakReplies(event.target.checked)}
                    />
                    Speak replies
                </label>
                <label className="voice-select-row">
                    <span>Recognition</span>
                    <select
                        className="voice-select"
                        value={voice.asrModel}
                        onChange={event => {
                            if (isAsrModelKey(event.target.value)) voice.setAsrModel(event.target.value)
                        }}
                    >
                        {Object.entries(ASR_MODELS).map(([key, config]) => (
                            <option key={key} value={key}>
                                {config.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="voice-select-row">
                    <span>Reply voice</span>
                    <select
                        className="voice-select"
                        value={voice.ttsVoice}
                        onChange={event => voice.setTtsVoice(event.target.value)}
                    >
                        <optgroup label={`Neural — local AI${voice.ttsStatus === 'loading' ? ' (downloading…)' : ''}`}>
                            {KOKORO_VOICES.map(option => (
                                <option key={option.id} value={option.id} disabled={voice.ttsStatus === 'error'}>
                                    {option.label}
                                </option>
                            ))}
                        </optgroup>
                        <optgroup label="System">
                            {voice.systemVoices.map(name => (
                                <option key={name} value={`system:${name}`}>
                                    {name}
                                </option>
                            ))}
                        </optgroup>
                    </select>
                </label>
            </div>

            <div className="voice-activity">
                {voice.transcribing && <div className="voice-transcribing">transcribing…</div>}
                {voice.speaking && !voice.transcribing && <div className="voice-transcribing">hearing you…</div>}
                {voice.lastActivity && (
                    <>
                        <div className="voice-heard">“{voice.lastActivity.transcript}”</div>
                        <div className={`voice-reply ${voice.lastActivity.ok ? '' : 'voice-reply-error'}`}>
                            {voice.lastActivity.reply}
                        </div>
                    </>
                )}
            </div>

            <button className="link-button" onClick={() => setShowCommands(previous => !previous)}>
                {showCommands ? 'Hide commands' : 'What can I say?'}
            </button>
            {showCommands && (
                <table className="voice-commands">
                    <tbody>
                        {VOICE_COMMAND_EXAMPLES.map(example => (
                            <tr key={example.phrase}>
                                <td className="voice-command-phrase">{example.phrase}</td>
                                <td>{example.action}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    )
}
