'use client'

import { FactStrip, SheetClosing, SheetHeadline, SheetPage, SheetSection } from '@/app/components/sheet-page'
import { BTN_GHOST, BTN_SOLID, LINKS } from '@/app/components/site-links'
import { ASSET_FORMATS, getAssetFilename, type AssetFormat } from '@/app/press-kit/formats'
import { canvasToPngBlob, readTypefaces, renderAssetCanvas } from '@/app/press-kit/render-asset'
import {
    PICTURE_SIZE,
    runSitePicture,
    type PictureFraming,
    type PictureLabel,
    type SitePicture,
} from '@/app/press-kit/site-picture'
import { createZipBytes, type ZipEntry } from '@/app/press-kit/zip'
import { useCallback, useEffect, useRef, useState } from 'react'

const DOCUMENT_NUMBER = 'DG-PK-001'
const ZIP_FILENAME = 'darkgrade-press-kit.zip'
/** Where the backdrop is cropped to behind the banners and the full-bleed square, 0 = its top edge, 1 = its foot. */
const BACKDROP_POSITION_Y = 0.5
/** The picture behind the link preview card: the camera as Link drives it, with its four readings pinned to it. The laptop is left out, and the camera stands to the right of the words. */
const CARD_PICTURE: PictureFraming = {
    chapter: 'link',
    standBack: 0.61,
    reframe: { shiftRight: 0.215, shiftDown: 0.07, laptop: 0, laptopOnSet: 0.25 },
}
/**
 * The picture behind the banners and the full-bleed square: the same dust at the same moment of
 * its swells, with the camera and the laptop out of the frame. Seen square on, as the page's
 * closing shots are, the dust is as bright on the left as on the right; behind a card it is
 * quieter on the left, where the card's words are.
 */
const BACKDROP_PICTURE: PictureFraming = {
    chapter: 'link',
    standBack: 1,
    reframe: { shiftRight: 3, laptop: 0, onLens: 1 },
}
/** How big the backdrop is drawn, in CSS pixels: at two device pixels each, the size of the largest banner. */
const BACKDROP_SIZE = { width: 1280, height: 720 }
/** How much of the window's height a preview may take, so a tall image does not fill the page. */
const TALLEST_PREVIEW = '62vh'

/* The words of the Press kit page. */
const PRESS_KIT = {
    headline: { first: 'Press kit', second: 'ready to', lit: 'use.' },
    lede: 'Every image on this page is drawn by the site itself, at the size the platform asks for. Take the one you need, or the whole set as a zip.',
    facts: [
        { name: 'Images', value: `${ASSET_FORMATS.length} sizes` },
        { name: 'Format', value: 'PNG, exact pixels' },
        { name: 'The name', value: 'Darkgrade, one word' },
        { name: 'Questions', value: LINKS.contactEmail, href: `mailto:${LINKS.contactEmail}` },
    ],
    closing: {
        line: 'Writing something about us?',
        detail: 'Tell us what you need and a person will send it: a quote, a photograph of the team, or an image at a size that isn’t on this page.',
    },
} as const

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

/** A copy of the frame a live canvas is holding, drawn into `moment` when there is one to reuse. Nothing new while the canvas has not been drawn. */
function copyFrame(live: HTMLCanvasElement | null, moment: HTMLCanvasElement | null): HTMLCanvasElement | null {
    if (!live || !live.width) return moment
    const copy = moment ?? document.createElement('canvas')
    copy.width = live.width
    copy.height = live.height
    copy.getContext('2d')?.drawImage(live, 0, 0)
    return copy
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

/**
 * The Press kit page: the site's own images, drawn live at the size each platform asks for, with
 * one to download and the set as a zip. The preview IS the canvas that is downloaded, scaled down
 * by CSS, so what is on the page is what the file holds.
 */
export function PressKit() {
    const [activeId, setActiveId] = useState(ASSET_FORMATS[0].id)
    const [busyMessage, setBusyMessage] = useState<string | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
    const renderTokenRef = useRef(0)
    /* The home page's picture, drawn live on two canvases that are never shown: the
       camera with its readings for the card, and the dust on its own for everything
       else that has a backdrop. An image is drawn over one moment of them, copied out
       here, so the preview and the download are the same moment. */
    const liveCardPictureRef = useRef<HTMLCanvasElement | null>(null)
    const liveBackdropRef = useRef<HTMLCanvasElement | null>(null)
    const cardPictureRef = useRef<HTMLCanvasElement | null>(null)
    const cardPictureLabelsRef = useRef<PictureLabel[]>([])
    const backdropRef = useRef<HTMLCanvasElement | null>(null)
    const runningCardPictureRef = useRef<SitePicture | null>(null)
    const [momentVersion, setMomentVersion] = useState(0)

    const captureMoment = useCallback(() => {
        cardPictureRef.current = copyFrame(liveCardPictureRef.current, cardPictureRef.current)
        cardPictureLabelsRef.current = runningCardPictureRef.current?.labels() ?? []
        backdropRef.current = copyFrame(liveBackdropRef.current, backdropRef.current)
        setMomentVersion(version => version + 1)
    }, [])

    useEffect(() => {
        const [liveCardPicture, liveBackdrop] = [liveCardPictureRef.current, liveBackdropRef.current]
        if (!liveCardPicture || !liveBackdrop) return
        const cardPicture = runSitePicture(liveCardPicture, CARD_PICTURE, captureMoment)
        const backdrop = runSitePicture(liveBackdrop, BACKDROP_PICTURE, captureMoment)
        runningCardPictureRef.current = cardPicture
        return () => {
            runningCardPictureRef.current = null
            cardPicture.stop()
            backdrop.stop()
        }
    }, [captureMoment])

    /* The images are set in the site's own faces: until those have loaded, the type
       is measured and drawn in the fallback. Draw them again once they land. */
    const [typefaceVersion, setTypefaceVersion] = useState(0)
    useEffect(() => {
        const redraw = () => setTypefaceVersion(version => version + 1)
        document.fonts.addEventListener('loadingdone', redraw)
        return () => document.fonts.removeEventListener('loadingdone', redraw)
    }, [])

    const activeFormat = ASSET_FORMATS.find(format => format.id === activeId) ?? ASSET_FORMATS[0]

    const drawingOptions = useCallback(
        () => ({
            typefaces: readTypefaces(),
            backdrop: backdropRef.current,
            backdropPositionY: BACKDROP_POSITION_Y,
            picture: cardPictureRef.current,
            pictureLabels: cardPictureLabelsRef.current,
        }),
        []
    )

    useEffect(() => {
        const token = ++renderTokenRef.current
        renderAssetCanvas(activeFormat, drawingOptions())
            .then(rendered => {
                const target = previewCanvasRef.current
                if (token !== renderTokenRef.current || !target) return // a newer render superseded this one
                target.width = rendered.width
                target.height = rendered.height
                target.getContext('2d')?.drawImage(rendered, 0, 0)
                setErrorMessage(null)
            })
            .catch(error => setErrorMessage(String(error?.message ?? error)))
    }, [activeFormat, drawingOptions, momentVersion, typefaceVersion])

    const downloadOne = useCallback(
        async (format: AssetFormat) => {
            setBusyMessage(`Drawing the ${format.tabLabel} image…`)
            try {
                const rendered = await renderAssetCanvas(format, drawingOptions())
                saveBlob(await canvasToPngBlob(rendered), getAssetFilename(format))
                setErrorMessage(null)
            } catch (error) {
                setErrorMessage(String((error as Error)?.message ?? error))
            } finally {
                setBusyMessage(null)
            }
        },
        [drawingOptions]
    )

    const downloadAll = useCallback(async () => {
        try {
            const entries: ZipEntry[] = []
            for (const [index, format] of ASSET_FORMATS.entries()) {
                setBusyMessage(`Drawing ${index + 1} of ${ASSET_FORMATS.length} · ${format.tabLabel}…`)
                const rendered = await renderAssetCanvas(format, drawingOptions())
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
    }, [drawingOptions])

    return (
        <SheetPage name="Press kit" title="Logos and images" document={DOCUMENT_NUMBER}>
            {/* the home page's picture, drawn twice and kept out of sight: only its frames are used */}
            <canvas
                ref={liveCardPictureRef}
                aria-hidden="true"
                className="pointer-events-none fixed top-0 left-0 -z-10 opacity-0"
                style={PICTURE_SIZE}
            />
            <canvas
                ref={liveBackdropRef}
                aria-hidden="true"
                className="pointer-events-none fixed top-0 left-0 -z-10 opacity-0"
                style={BACKDROP_SIZE}
            />

            <SheetHeadline {...PRESS_KIT.headline} lede={PRESS_KIT.lede} />
            <FactStrip facts={PRESS_KIT.facts} />

            <SheetSection name="Images" title="Pick a size and take the PNG">
                <nav aria-label="Image size" className="mt-8 flex flex-wrap gap-2">
                    {ASSET_FORMATS.map(format => (
                        <button
                            key={format.id}
                            type="button"
                            aria-pressed={format.id === activeFormat.id}
                            onClick={() => setActiveId(format.id)}
                            className="shrink-0 cursor-pointer rounded-[10px] border border-hair px-4 py-[10px] text-left transition-[border-color,background,color] duration-[250ms] hover:border-gold aria-pressed:border-[rgba(244,198,110,.5)] aria-pressed:bg-gold-dim aria-pressed:text-gold"
                        >
                            <div className="text-[13px]">{format.tabLabel}</div>
                            <div className="mt-[2px] font-mono text-[10.5px] tracking-[.06em] text-ink-52">
                                {formatDimensions(format)}
                            </div>
                        </button>
                    ))}
                </nav>

                <div className="mt-5 flex justify-center">
                    <div
                        className="overflow-hidden rounded-[6px] border border-hair shadow-[0_20px_80px_rgba(0,0,0,.55)]"
                        style={{
                            aspectRatio: `${activeFormat.width} / ${activeFormat.height}`,
                            width: `min(100%, calc(${TALLEST_PREVIEW} * ${activeFormat.width} / ${activeFormat.height}))`,
                            ...getPreviewBackdrop(activeFormat),
                        }}
                    >
                        <canvas
                            ref={previewCanvasRef}
                            width={activeFormat.width}
                            height={activeFormat.height}
                            role="img"
                            aria-label={`${activeFormat.platform}, ${formatDimensions(activeFormat)} pixels`}
                            className="block h-full w-full"
                        />
                    </div>
                </div>

                <div className="mt-6 flex flex-wrap items-start justify-between gap-6">
                    <div className="max-w-[56ch]">
                        <div className="font-mono text-[11px] tracking-[.08em] text-ink-55 uppercase">
                            {activeFormat.platform}
                        </div>
                        <p className="mt-3 text-body leading-[1.6] text-ink-66">{activeFormat.note}</p>
                    </div>
                    <div className="flex flex-col items-end gap-3 max-[700px]:w-full max-[700px]:items-start">
                        <div className="flex flex-wrap justify-end gap-[14px] max-[700px]:justify-start">
                            <button
                                type="button"
                                disabled={busyMessage !== null}
                                onClick={() => void downloadOne(activeFormat)}
                                className={`${BTN_SOLID} cursor-pointer disabled:cursor-wait disabled:opacity-60`}
                            >
                                Download PNG · {formatDimensions(activeFormat)}
                            </button>
                            <button
                                type="button"
                                disabled={busyMessage !== null}
                                onClick={() => void downloadAll()}
                                className={`${BTN_GHOST} cursor-pointer disabled:cursor-wait disabled:opacity-60`}
                            >
                                All {ASSET_FORMATS.length} as a zip
                            </button>
                        </div>
                        <div
                            className="min-h-[1.2em] font-mono text-[11px] tracking-[.06em] text-ink-52"
                            aria-live="polite"
                        >
                            {busyMessage}
                            {errorMessage && <span className="text-rec">{errorMessage}</span>}
                        </div>
                    </div>
                </div>
            </SheetSection>

            <SheetClosing line={PRESS_KIT.closing.line} detail={PRESS_KIT.closing.detail}>
                <a className={BTN_SOLID} href={`mailto:${LINKS.contactEmail}`}>
                    {LINKS.contactEmail}
                </a>
                <a className={BTN_GHOST} href="/about">
                    About Darkgrade
                </a>
            </SheetClosing>
        </SheetPage>
    )
}
