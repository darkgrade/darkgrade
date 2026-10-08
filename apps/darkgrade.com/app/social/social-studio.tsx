'use client'

import { LOOPBACK_HOSTNAMES } from '@/app/components/dev-font-chooser/dev-fonts'
import { ASSET_FORMATS, getAssetFilename, type AssetFormat, type Guide } from '@/app/social/formats'
import { canvasToPngBlob, readTypefaces, renderAssetCanvas } from '@/app/social/render-asset'
import { createZipBytes, type ZipEntry } from '@/app/social/zip'
import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'darkgrade:social-studio:v1'
const DEFAULT_FRAME_SECONDS = 42
const FRAME_RANGE_SECONDS = { minimum: 8, maximum: 240 } as const
const FONT_CHANGE_DEBOUNCE_MILLISECONDS = 60
const ZIP_FILENAME = 'darkgrade-social-heroes.zip'

/* Space the page chrome takes above the preview, so a tall asset (YouTube,
   the squares) shrinks to fit the viewport instead of scrolling. */
const CHROME_HEIGHT_PIXELS = 380

interface StudioState {
    activeId: string
    frameSeconds: number
    showGuides: boolean
}

const DEFAULT_STATE: StudioState = {
    activeId: ASSET_FORMATS[0].id,
    frameSeconds: DEFAULT_FRAME_SECONDS,
    showGuides: true,
}

function readStoredState(): StudioState {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
        if (!stored) return DEFAULT_STATE
        return {
            activeId: ASSET_FORMATS.some(format => format.id === stored.activeId)
                ? stored.activeId
                : DEFAULT_STATE.activeId,
            frameSeconds: typeof stored.frameSeconds === 'number' ? stored.frameSeconds : DEFAULT_FRAME_SECONDS,
            showGuides: stored.showGuides !== false,
        }
    } catch {
        return DEFAULT_STATE
    }
}

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function formatDimensions(format: AssetFormat): string {
    return `${format.width} × ${format.height}`
}

/** A checkerboard so transparent PNGs read as transparent; light or dark to suit the mark. */
function getPreviewBackdrop(format: AssetFormat): React.CSSProperties {
    if (format.look !== 'mark-light-mode' && format.look !== 'mark-dark-mode') return {}
    const [first, second] = format.look === 'mark-light-mode' ? ['#f2f2f0', '#dcdcd8'] : ['#151517', '#222225']
    return {
        backgroundColor: first,
        backgroundImage: `conic-gradient(${second} 25%, transparent 0 50%, ${second} 0 75%, transparent 0)`,
        backgroundSize: '24px 24px',
    }
}

function GuideOverlay({ format, guide }: { format: AssetFormat; guide: Guide }) {
    const { x, y, width, height } = guide.rectangle
    const isSafe = guide.kind === 'safe'
    return (
        <div
            className={`pointer-events-none absolute border ${
                isSafe
                    ? 'border-dashed border-[rgba(246,221,168,.85)]'
                    : 'border-[rgba(224,72,62,.8)] bg-[repeating-linear-gradient(135deg,rgba(224,72,62,.22)_0_6px,transparent_6px_12px)]'
            }`}
            style={{
                left: `${(x / format.width) * 100}%`,
                top: `${(y / format.height) * 100}%`,
                width: `${(width / format.width) * 100}%`,
                height: `${(height / format.height) * 100}%`,
            }}
        >
            <span
                className={`absolute left-1 rounded-[3px] bg-[rgba(10,10,11,.75)] px-[6px] py-[2px] font-mono text-[10px] tracking-[.08em] whitespace-nowrap uppercase ${
                    isSafe ? 'bottom-full mb-1 text-gold' : 'top-1 text-rec'
                }`}
            >
                {guide.label}
            </span>
        </div>
    )
}

export function SocialStudio() {
    const [isLoopback, setIsLoopback] = useState(false)
    const [state, setState] = useState<StudioState>(DEFAULT_STATE)
    const [hasLoadedStorage, setHasLoadedStorage] = useState(false)
    const [typefaceVersion, setTypefaceVersion] = useState(0)
    const [busyMessage, setBusyMessage] = useState<string | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
    const renderTokenRef = useRef(0)

    const activeFormat = ASSET_FORMATS.find(format => format.id === state.activeId) ?? ASSET_FORMATS[0]

    useEffect(() => {
        if (!LOOPBACK_HOSTNAMES.includes(location.hostname)) return
        // The home page holds the document at viewport height until its loader finishes.
        document.documentElement.classList.remove('preload')
        setIsLoopback(true)
        setState(readStoredState())
        setHasLoadedStorage(true)
    }, [])

    useEffect(() => {
        if (hasLoadedStorage) localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    }, [hasLoadedStorage, state])

    /* The font chooser changes fonts by rewriting the design tokens on <html>
       and declaring new @font-face rules. Watch for that and redraw. */
    useEffect(() => {
        if (!isLoopback) return
        let timer = 0
        const scheduleRedraw = () => {
            window.clearTimeout(timer)
            timer = window.setTimeout(
                () => setTypefaceVersion(version => version + 1),
                FONT_CHANGE_DEBOUNCE_MILLISECONDS
            )
        }
        const observer = new MutationObserver(scheduleRedraw)
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
        document.fonts.addEventListener('loadingdone', scheduleRedraw)
        return () => {
            window.clearTimeout(timer)
            observer.disconnect()
            document.fonts.removeEventListener('loadingdone', scheduleRedraw)
        }
    }, [isLoopback])

    useEffect(() => {
        if (!hasLoadedStorage) return
        const token = ++renderTokenRef.current
        renderAssetCanvas(activeFormat, { typefaces: readTypefaces(), frameSeconds: state.frameSeconds })
            .then(rendered => {
                const target = previewCanvasRef.current
                if (token !== renderTokenRef.current || !target) return // a newer render superseded this one
                target.width = rendered.width
                target.height = rendered.height
                target.getContext('2d')?.drawImage(rendered, 0, 0)
                setErrorMessage(null)
            })
            .catch(error => setErrorMessage(String(error?.message ?? error)))
    }, [hasLoadedStorage, activeFormat, state.frameSeconds, typefaceVersion])

    const downloadOne = useCallback(
        async (format: AssetFormat) => {
            setBusyMessage(`Rendering ${format.tabLabel}…`)
            try {
                const rendered = await renderAssetCanvas(format, {
                    typefaces: readTypefaces(),
                    frameSeconds: state.frameSeconds,
                })
                saveBlob(await canvasToPngBlob(rendered), getAssetFilename(format))
                setErrorMessage(null)
            } catch (error) {
                setErrorMessage(String((error as Error)?.message ?? error))
            } finally {
                setBusyMessage(null)
            }
        },
        [state.frameSeconds]
    )

    const downloadAll = useCallback(async () => {
        try {
            const entries: ZipEntry[] = []
            for (const [index, format] of ASSET_FORMATS.entries()) {
                setBusyMessage(`Rendering ${index + 1} of ${ASSET_FORMATS.length} · ${format.tabLabel}…`)
                const rendered = await renderAssetCanvas(format, {
                    typefaces: readTypefaces(),
                    frameSeconds: state.frameSeconds,
                })
                const png = await canvasToPngBlob(rendered)
                entries.push({ name: getAssetFilename(format), bytes: new Uint8Array(await png.arrayBuffer()) })
            }
            saveBlob(new Blob([createZipBytes(entries)], { type: 'application/zip' }), ZIP_FILENAME)
            setErrorMessage(null)
        } catch (error) {
            setErrorMessage(String((error as Error)?.message ?? error))
        } finally {
            setBusyMessage(null)
        }
    }, [state.frameSeconds])

    const pickNewFrame = useCallback(() => {
        const { minimum, maximum } = FRAME_RANGE_SECONDS
        const frameSeconds = Math.round((minimum + Math.random() * (maximum - minimum)) * 10) / 10
        setState(previous => ({ ...previous, frameSeconds }))
    }, [])

    useEffect(() => {
        if (!isLoopback) return
        const stepTab = (offset: number) =>
            setState(previous => {
                const index = ASSET_FORMATS.findIndex(format => format.id === previous.activeId)
                const next = (index + offset + ASSET_FORMATS.length) % ASSET_FORMATS.length
                return { ...previous, activeId: ASSET_FORMATS[next].id }
            })

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return
            const handlers: Record<string, () => void> = {
                '[': () => stepTab(-1),
                ']': () => stepTab(1),
                g: () => setState(previous => ({ ...previous, showGuides: !previous.showGuides })),
                n: pickNewFrame,
                d: () => void downloadOne(activeFormat),
                D: () => void downloadAll(),
            }
            const handler = handlers[event.key]
            if (!handler || busyMessage) return
            event.preventDefault()
            handler()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isLoopback, activeFormat, busyMessage, downloadAll, downloadOne, pickNewFrame])

    if (!isLoopback) return null

    const aspectRatio = activeFormat.width / activeFormat.height

    return (
        // Bottom padding leaves room to scroll the notes clear of the font chooser panel.
        <main className="min-h-dvh px-6 pt-8 pb-[440px] text-ink md:px-10">
            <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="mb-3 font-mono text-[10px] tracking-[.22em] text-ink-52 uppercase">
                        Dev only · localhost
                    </div>
                    <h1 className="font-serif text-[clamp(36px,4vw,56px)] leading-none">
                        Social <span className="glow-hot italic">heroes</span>
                    </h1>
                </div>
                <button
                    type="button"
                    disabled={busyMessage !== null}
                    onClick={() => void downloadAll()}
                    title="Render all seven images and download them as one zip (Shift+D)"
                    className="cursor-pointer rounded-full bg-ink px-6 py-3 text-[13px] font-[480] tracking-[.04em] text-obsidian transition-[background,box-shadow] duration-[350ms] hover:bg-gold hover:shadow-[0_0_26px_rgba(244,198,110,.16)] disabled:cursor-wait disabled:opacity-60"
                >
                    Download all · {ASSET_FORMATS.length} PNGs (.zip)
                </button>
            </header>

            <nav aria-label="Image format" className="mb-5 flex gap-2 overflow-x-auto pb-1">
                {ASSET_FORMATS.map(format => (
                    <button
                        key={format.id}
                        type="button"
                        aria-pressed={format.id === activeFormat.id}
                        onClick={() => setState(previous => ({ ...previous, activeId: format.id }))}
                        className="shrink-0 cursor-pointer rounded-[10px] border border-hair px-4 py-[10px] text-left transition-[border-color,background,color] duration-[250ms] hover:border-gold aria-pressed:border-[rgba(244,198,110,.5)] aria-pressed:bg-gold-dim aria-pressed:text-gold"
                    >
                        <div className="text-[13px] font-[480]">{format.tabLabel}</div>
                        <div className="mt-[2px] font-mono text-[10.5px] tracking-[.06em] text-ink-52">
                            {formatDimensions(format)}
                        </div>
                    </button>
                ))}
            </nav>

            <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] tracking-[.08em] text-ink-55 uppercase">
                <span className="text-ink">{activeFormat.platform}</span>
                <span>{formatDimensions(activeFormat)} px</span>
                <span>{activeFormat.fileNote}</span>
                <span className="flex-1" />
                <button type="button" onClick={pickNewFrame} className="cursor-pointer uppercase hover:text-gold">
                    New silk frame (N)
                </button>
                {activeFormat.guides.length > 0 && (
                    <button
                        type="button"
                        aria-pressed={state.showGuides}
                        onClick={() => setState(previous => ({ ...previous, showGuides: !previous.showGuides }))}
                        className="cursor-pointer uppercase hover:text-gold aria-pressed:text-gold"
                    >
                        Guides {state.showGuides ? 'on' : 'off'} (G)
                    </button>
                )}
            </div>

            <div className="flex justify-center">
                <div
                    className="relative overflow-hidden rounded-[6px] border border-hair shadow-[0_20px_80px_rgba(0,0,0,.55)]"
                    style={{
                        aspectRatio: `${activeFormat.width} / ${activeFormat.height}`,
                        width: `min(100%, calc((100dvh - ${CHROME_HEIGHT_PIXELS}px) * ${aspectRatio}))`,
                        minWidth: 280,
                        ...getPreviewBackdrop(activeFormat),
                    }}
                >
                    <canvas
                        ref={previewCanvasRef}
                        width={activeFormat.width}
                        height={activeFormat.height}
                        className="block h-full w-full"
                    />
                    {state.showGuides &&
                        activeFormat.guides.map(guide => (
                            <GuideOverlay key={guide.label} format={activeFormat} guide={guide} />
                        ))}
                </div>
            </div>

            <div className="mt-6 flex flex-wrap items-start justify-between gap-6">
                <div className="max-w-[68ch] text-[14px] leading-[1.65] text-ink-55">
                    {activeFormat.notes.map(note => (
                        <p key={note} className="mb-2">
                            {note}
                        </p>
                    ))}
                    <p className="font-mono text-[11px] tracking-[.06em] text-ink-52">
                        Size source:{' '}
                        <a
                            href={activeFormat.source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2 hover:text-gold"
                        >
                            {activeFormat.source.label}
                        </a>
                    </p>
                    <p className="mt-3 font-mono text-[11px] tracking-[.06em] text-ink-52">
                        Keys: [ ] switch tab · N new silk frame · G guides · D download · Shift+D download all. Fonts
                        follow the font chooser (bottom left).
                    </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <button
                        type="button"
                        disabled={busyMessage !== null}
                        onClick={() => void downloadOne(activeFormat)}
                        className="cursor-pointer rounded-full border border-hair px-6 py-3 text-[13px] font-[480] tracking-[.04em] text-ink transition-[border-color,color,box-shadow] duration-[350ms] hover:border-gold hover:text-gold hover:shadow-[0_0_26px_rgba(244,198,110,.16)] disabled:cursor-wait disabled:opacity-60"
                    >
                        Download PNG · {formatDimensions(activeFormat)}
                    </button>
                    <div
                        className="min-h-[1.2em] font-mono text-[11px] tracking-[.06em] text-ink-52"
                        aria-live="polite"
                    >
                        {busyMessage}
                        {errorMessage && <span className="text-rec">{errorMessage}</span>}
                    </div>
                </div>
            </div>
        </main>
    )
}
