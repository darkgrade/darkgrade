import { LiveViewPanel } from '@renderer/components/LiveViewPanel'
import { DEFAULT_PREVIEW_ASSISTS } from '@renderer/gpu/assists'
import type { CameraState } from '@shared/ipc'
import { cloneElement, createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/lib/live-frame-store', () => ({
    useHasLiveFrame: () => true,
    useFocusFrames: () => [],
}))
vi.mock('@renderer/gpu/LivePicture', () => ({
    LivePicture: ({ recording }: { recording: boolean }) =>
        createElement('div', { 'data-recording-tally': recording }),
}))
vi.mock('@renderer/components/VisionOverlays', () => ({
    VisionOverlayLayer: () => createElement('div', { 'data-vision-overlay': true }),
}))
vi.mock('@renderer/components/PreviewQuality', () => ({ PreviewQuality: () => null }))
vi.mock('@renderer/components/HoverTip', () => ({
    HoverTip: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
        cloneElement(render, {}, children),
}))

const connectedState: CameraState = {
    connected: true,
    phase: 'connected',
    vendor: 'Sony',
    model: 'Test camera',
    battery: null,
    card: null,
    lens: null,
    clock: null,
    controls: null,
    osdOverlay: null,
    clickToFocus: true,
    liveView: true,
    recording: true,
    recordingState: 'recording',
    settings: { iso: null, shutterSpeed: null, aperture: null },
    downloadDir: '',
    platform: '',
}

function renderView(recordingState: CameraState['recordingState']): string {
    return renderToStaticMarkup(createElement(LiveViewPanel, {
        header: null,
        cameraState: { ...connectedState, recordingState },
        visionOverlays: true,
        busy: true,
        capturing: false,
        readingCard: false,
        locked: true,
        onRetryLiveView: vi.fn(),
        onFocus: vi.fn(),
        onFocusAt: null,
        previewAssists: DEFAULT_PREVIEW_ASSISTS,
        onCapture: vi.fn(),
        onStartRecording: vi.fn(),
        onStopRecording: vi.fn(),
        voiceOpen: false,
        voiceListening: false,
        onToggleVoice: vi.fn(),
        preview: { live: true, quality: null, disabled: true, onQualityChange: vi.fn() },
    }))
}

describe('recording state in the live view', () => {
    it('shows REC and the GPU tally only after the body confirms recording', () => {
        const html = renderView('recording')
        expect(html).toMatch(/>REC</)
        expect(html).toContain('data-recording-tally="true"')
        expect(html).toContain('data-vision-overlay="true"')
    })

    it.each(['starting', 'stopping', 'unknown', 'idle'] as const)(
        'keeps Stop available without a false REC tally when owned recording state is %s',
        state => {
            const html = renderView(state)
            expect(html).not.toMatch(/>REC</)
            expect(html).toContain('data-recording-tally="false"')
            const stop = html.match(/<button[^>]*aria-label="Stop recording"[^>]*>/)?.[0]
            expect(stop).toBeDefined()
            expect(stop).not.toMatch(/\bdisabled(?:=|\s|>)/)
            expect(html).toContain(state === 'idle' ? 'retry Stop to restore setup'
                : state === 'unknown' ? 'Recording unconfirmed' : `Recording ${state}`)
        }
    )
})
