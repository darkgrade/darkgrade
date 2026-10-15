import { ICON_PATHS, ICON_VIEWBOX, WORDMARK_PATHS, WORDMARK_VIEWBOX } from '@/app/components/wordmark-paths'
import type { AssetFormat, PixelRectangle } from '@/app/social/formats'

/**
 * Draws a social image at its exact pixel size.
 *
 * The preview on the page IS this canvas, scaled down by CSS, so what you see
 * is byte-for-byte what you download. The backdrop is a frame of the site's
 * background video under the studio's uniform dim, the type is whatever the
 * font chooser currently has applied,
 * and the glow on "less." is the site's text-shadow stack re-expressed as
 * canvas shadows.
 */

export interface Typefaces {
    /** Resolved CSS font-family lists, read from the live design tokens. */
    readonly heading: string
    readonly body: string
    readonly mono: string
}

export interface RenderOptions {
    readonly typefaces: Typefaces
    /** The chosen video frame at its native size, or null to render on flat
     *  obsidian (no video chosen yet). Cover-cropped to each format. */
    readonly backdrop: HTMLCanvasElement | null
    /** Vertical crop of the backdrop, 0 = top edge to 1 = bottom edge (CSS object-position-y). */
    readonly backdropPositionY: number
}

const BONE = '#eae6dc'
const BONE_MUTED = 'rgba(234, 230, 220, 0.55)'
const GOLD = '#f6dda8'
const OBSIDIAN = '#0a0a0b'

const HEADLINE_BEFORE_HIGHLIGHT = 'Shoot more. Edit '
const HEADLINE_HIGHLIGHT = 'less.'
const TAGLINE = 'Local-first AI for creative professionals'
const SITE_ADDRESS = 'darkgrade.com'

/* Type sizes in "design units": the headline is 100, everything else is
   relative to it. The whole composition is then scaled to fit its content area. */
const HEADLINE_SIZE = 100
const TAGLINE_SIZE = 19
const ADDRESS_SIZE = 14
const WORDMARK_HEIGHT = 20
const STACK_GAP = 30
const INLINE_GAP = 30
const INLINE_COLUMN_GAP = 56
const FIT_MARGIN = 0.94
const MAXIMUM_SCALE = 2.4
const WIDE_LAYOUT_ASPECT_RATIO = 5

/** Share of the square the icon spans. */
const SQUARE_MARK_WIDTH_RATIO = 0.62

/** The studio's dim over the video: uniform black at this opacity. */
const BACKDROP_DIM = 0.6

/* The site's `glow-hot` text-shadow stack: [blur px, y offset px, colour]. The
   radii are absolute on the site (tuned for ~32-90px type), so they are scaled
   by type size here. */
const GLOW_LAYERS: ReadonlyArray<readonly [number, number, string]> = [
    [76, 1, 'rgba(190, 105, 30, 0.2)'],
    [34, 0, 'rgba(216, 150, 60, 0.34)'],
    [14, 0, 'rgba(244, 198, 110, 0.55)'],
    [5, 0, 'rgba(255, 238, 205, 0.7)'],
    [1, 0, 'rgba(255, 247, 230, 0.85)'],
]
const GLOW_REFERENCE_FONT_SIZE = 80

export function readTypefaces(): Typefaces {
    const styles = getComputedStyle(document.documentElement)
    const read = (variable: string, fallback: string) => styles.getPropertyValue(variable).trim() || fallback
    return {
        heading: read('--font-serif', 'Georgia, serif'),
        body: read('--font-sans', 'system-ui, sans-serif'),
        mono: read('--font-mono', 'ui-monospace, monospace'),
    }
}

async function loadTypefaces(typefaces: Typefaces): Promise<void> {
    const sample = `${HEADLINE_BEFORE_HIGHLIGHT}${HEADLINE_HIGHLIGHT} ${TAGLINE} ${SITE_ADDRESS}`
    await Promise.all([
        document.fonts.load(`400 100px ${typefaces.heading}`, sample),
        document.fonts.load(`italic 400 100px ${typefaces.heading}`, sample),
        document.fonts.load(`340 100px ${typefaces.body}`, sample),
        document.fonts.load(`400 100px ${typefaces.mono}`, sample),
    ]).catch(() => undefined)
}

/* ---------- backdrop ---------- */

function createCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
}

/** The video frame, scaled to cover the asset (CSS object-fit: cover), centred
 *  across and placed by `backdropPositionY` down, then the uniform dim. Without
 *  a frame, flat obsidian. */
function drawBackdrop(context: CanvasRenderingContext2D, width: number, height: number, options: RenderOptions): void {
    context.fillStyle = OBSIDIAN
    context.fillRect(0, 0, width, height)
    const source = options.backdrop
    if (!source || !source.width || !source.height) return

    const scale = Math.max(width / source.width, height / source.height)
    const drawnWidth = source.width * scale
    const drawnHeight = source.height * scale
    context.imageSmoothingQuality = 'high'
    const positionY = Math.min(1, Math.max(0, options.backdropPositionY))
    context.drawImage(source, (width - drawnWidth) / 2, (height - drawnHeight) * positionY, drawnWidth, drawnHeight)
    context.fillStyle = `rgba(0, 0, 0, ${BACKDROP_DIM})`
    context.fillRect(0, 0, width, height)
}

/* ---------- marks ---------- */

function fillPaths(
    context: CanvasRenderingContext2D,
    paths: readonly string[],
    left: number,
    top: number,
    scale: number,
    color: string
): void {
    context.save()
    context.translate(left, top)
    context.scale(scale, scale)
    context.fillStyle = color
    paths.forEach(pathData => context.fill(new Path2D(pathData)))
    context.restore()
}

/** The site's `mark-glow`: two soft drop-shadows under the mark. */
function fillPathsWithMarkGlow(
    context: CanvasRenderingContext2D,
    paths: readonly string[],
    left: number,
    top: number,
    scale: number,
    glowScale: number
): void {
    const shadows: ReadonlyArray<readonly [number, string]> = [
        [22, 'rgba(244, 198, 110, 0.1)'],
        [6, 'rgba(234, 230, 220, 0.16)'],
    ]
    shadows.forEach(([blur, color]) => {
        context.save()
        context.shadowBlur = blur * glowScale
        context.shadowColor = color
        fillPaths(context, paths, left, top, scale, BONE)
        context.restore()
    })
    fillPaths(context, paths, left, top, scale, BONE)
}

/* ---------- type ---------- */

type LetterSpacingContext = CanvasRenderingContext2D & { letterSpacing: string }

function setLetterSpacing(context: CanvasRenderingContext2D, pixels: number): void {
    if ('letterSpacing' in context) (context as LetterSpacingContext).letterSpacing = `${pixels}px`
}

function drawGlowingText(
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    fontSize: number
): void {
    const glowScale = fontSize / GLOW_REFERENCE_FONT_SIZE
    context.fillStyle = GOLD
    GLOW_LAYERS.forEach(([blur, offsetY, color]) => {
        context.save()
        context.shadowBlur = blur * glowScale
        context.shadowOffsetY = offsetY * glowScale
        context.shadowColor = color
        context.fillText(text, x, y)
        context.restore()
    })
    context.fillText(text, x, y)
}

/* Text is measured twice: once at design size (scale 1) to work out how big the
   whole composition can be, then again at the scale it will actually be drawn.
   Glyph advances do not scale linearly (hinting, and rounding in monospaced
   faces), so positions must come from measurements taken at the drawn size. */
interface HeadlineMetrics {
    /** All in pixels at the scale they were measured at. */
    readonly beforeWidth: number
    readonly highlightWidth: number
    readonly ascent: number
    readonly descent: number
}

function measureHeadline(context: CanvasRenderingContext2D, typefaces: Typefaces, scale: number): HeadlineMetrics {
    const fontSize = HEADLINE_SIZE * scale
    context.textBaseline = 'alphabetic'
    setLetterSpacing(context, -0.015 * fontSize)
    context.font = `400 ${fontSize}px ${typefaces.heading}`
    const before = context.measureText(HEADLINE_BEFORE_HIGHLIGHT)
    const whole = context.measureText(`${HEADLINE_BEFORE_HIGHLIGHT}${HEADLINE_HIGHLIGHT}`)

    setLetterSpacing(context, 0)
    context.font = `italic 400 ${fontSize}px ${typefaces.heading}`
    const highlight = context.measureText(HEADLINE_HIGHLIGHT)

    return {
        beforeWidth: before.width,
        highlightWidth: highlight.width,
        ascent: Math.max(whole.actualBoundingBoxAscent, highlight.actualBoundingBoxAscent),
        descent: Math.max(whole.actualBoundingBoxDescent, highlight.actualBoundingBoxDescent),
    }
}

function drawHeadline(
    context: CanvasRenderingContext2D,
    typefaces: Typefaces,
    metrics: HeadlineMetrics,
    left: number,
    baseline: number,
    scale: number
): void {
    const fontSize = HEADLINE_SIZE * scale
    context.textBaseline = 'alphabetic'
    context.textAlign = 'left'

    context.fillStyle = BONE
    context.font = `400 ${fontSize}px ${typefaces.heading}`
    setLetterSpacing(context, -0.015 * fontSize)
    context.fillText(HEADLINE_BEFORE_HIGHLIGHT, left, baseline)

    context.font = `italic 400 ${fontSize}px ${typefaces.heading}`
    setLetterSpacing(context, 0)
    drawGlowingText(context, HEADLINE_HIGHLIGHT, left + metrics.beforeWidth, baseline, fontSize)
}

interface TaglineMetrics {
    /** In pixels at the scale they were measured at. */
    readonly taglineWidth: number
    readonly addressWidth: number
}

const ADDRESS_TRACKING_EM = 0.18
const TAGLINE_DOT_GAP = 16
const TAGLINE_DOT_RADIUS = 2.5

function measureTagline(context: CanvasRenderingContext2D, typefaces: Typefaces, scale: number): TaglineMetrics {
    setLetterSpacing(context, 0)
    context.font = `340 ${TAGLINE_SIZE * scale}px ${typefaces.body}`
    const taglineWidth = context.measureText(TAGLINE).width

    setLetterSpacing(context, ADDRESS_TRACKING_EM * ADDRESS_SIZE * scale)
    context.font = `400 ${ADDRESS_SIZE * scale}px ${typefaces.mono}`
    const addressWidth = context.measureText(SITE_ADDRESS.toUpperCase()).width
    setLetterSpacing(context, 0)
    return { taglineWidth, addressWidth }
}

function drawTagline(
    context: CanvasRenderingContext2D,
    typefaces: Typefaces,
    metrics: TaglineMetrics,
    left: number,
    baseline: number,
    scale: number,
    includeAddress: boolean
): void {
    context.textBaseline = 'alphabetic'
    context.textAlign = 'left'
    context.fillStyle = BONE_MUTED
    setLetterSpacing(context, 0)
    context.font = `340 ${TAGLINE_SIZE * scale}px ${typefaces.body}`
    context.fillText(TAGLINE, left, baseline)
    if (!includeAddress) return

    const dotX = left + metrics.taglineWidth + TAGLINE_DOT_GAP * scale
    context.save()
    context.shadowBlur = 8 * scale
    context.shadowColor = 'rgba(244, 198, 110, 0.7)'
    context.fillStyle = GOLD
    context.beginPath()
    context.arc(dotX, baseline - TAGLINE_SIZE * 0.3 * scale, TAGLINE_DOT_RADIUS * scale, 0, Math.PI * 2)
    context.fill()
    context.restore()

    drawAddress(context, typefaces, dotX + (TAGLINE_DOT_GAP + TAGLINE_DOT_RADIUS) * scale, baseline, scale)
}

function drawAddress(
    context: CanvasRenderingContext2D,
    typefaces: Typefaces,
    left: number,
    baseline: number,
    scale: number
): void {
    context.textBaseline = 'alphabetic'
    context.textAlign = 'left'
    context.fillStyle = GOLD
    context.font = `400 ${ADDRESS_SIZE * scale}px ${typefaces.mono}`
    setLetterSpacing(context, ADDRESS_TRACKING_EM * ADDRESS_SIZE * scale)
    context.fillText(SITE_ADDRESS.toUpperCase(), left, baseline)
    setLetterSpacing(context, 0)
}

/* ---------- banner composition ---------- */

const WORDMARK_WIDTH = (WORDMARK_HEIGHT * WORDMARK_VIEWBOX.width) / WORDMARK_VIEWBOX.height

function fitScale(area: PixelRectangle, naturalWidth: number, naturalHeight: number): number {
    return Math.min(area.width / naturalWidth, area.height / naturalHeight, MAXIMUM_SCALE / FIT_MARGIN) * FIT_MARGIN
}

/** Wordmark, headline and tagline stacked, left-aligned, the block centred in the area. */
function drawStackedBanner(context: CanvasRenderingContext2D, area: PixelRectangle, typefaces: Typefaces): void {
    const designHeadline = measureHeadline(context, typefaces, 1)
    const designTagline = measureTagline(context, typefaces, 1)

    const headlineWidth = designHeadline.beforeWidth + designHeadline.highlightWidth
    const headlineHeight = designHeadline.ascent + designHeadline.descent
    const taglineRowWidth =
        designTagline.taglineWidth + (TAGLINE_DOT_GAP + TAGLINE_DOT_RADIUS) * 2 + designTagline.addressWidth
    const naturalWidth = Math.max(WORDMARK_WIDTH, headlineWidth, taglineRowWidth)
    const naturalHeight = WORDMARK_HEIGHT + STACK_GAP + headlineHeight + STACK_GAP + TAGLINE_SIZE

    const scale = fitScale(area, naturalWidth, naturalHeight)
    const headline = measureHeadline(context, typefaces, scale)
    const tagline = measureTagline(context, typefaces, scale)
    const left = area.x + (area.width - naturalWidth * scale) / 2
    const top = area.y + (area.height - naturalHeight * scale) / 2

    fillPathsWithMarkGlow(
        context,
        WORDMARK_PATHS,
        left,
        top,
        (WORDMARK_HEIGHT * scale) / WORDMARK_VIEWBOX.height,
        scale
    )

    const headlineTop = top + (WORDMARK_HEIGHT + STACK_GAP) * scale
    drawHeadline(context, typefaces, headline, left, headlineTop + headline.ascent, scale)

    const taglineBaseline = headlineTop + (headlineHeight + STACK_GAP + TAGLINE_SIZE * 0.8) * scale
    drawTagline(context, typefaces, tagline, left, taglineBaseline, scale, true)
}

/** For very wide, short areas: headline and tagline on the left, mark and address on the right. */
function drawInlineBanner(context: CanvasRenderingContext2D, area: PixelRectangle, typefaces: Typefaces): void {
    const designHeadline = measureHeadline(context, typefaces, 1)
    const designTagline = measureTagline(context, typefaces, 1)

    const headlineWidth = designHeadline.beforeWidth + designHeadline.highlightWidth
    const headlineHeight = designHeadline.ascent + designHeadline.descent
    const leftColumnWidth = Math.max(headlineWidth, designTagline.taglineWidth)
    const leftColumnHeight = headlineHeight + INLINE_GAP + TAGLINE_SIZE
    const rightColumnWidth = Math.max(WORDMARK_WIDTH, designTagline.addressWidth)
    const rightColumnHeight = WORDMARK_HEIGHT + INLINE_GAP + ADDRESS_SIZE

    const naturalWidth = leftColumnWidth + INLINE_COLUMN_GAP * 2 + rightColumnWidth
    const naturalHeight = Math.max(leftColumnHeight, rightColumnHeight)
    const scale = fitScale(area, naturalWidth, naturalHeight)
    const headline = measureHeadline(context, typefaces, scale)
    const tagline = measureTagline(context, typefaces, scale)

    const left = area.x + (area.width - naturalWidth * scale) / 2
    const top = area.y + (area.height - naturalHeight * scale) / 2

    const leftTop = top + ((naturalHeight - leftColumnHeight) / 2) * scale
    drawHeadline(context, typefaces, headline, left, leftTop + headline.ascent, scale)
    drawTagline(
        context,
        typefaces,
        tagline,
        left,
        leftTop + (headlineHeight + INLINE_GAP + TAGLINE_SIZE * 0.8) * scale,
        scale,
        false
    )

    const drawnLeftColumnWidth = Math.max(headline.beforeWidth + headline.highlightWidth, tagline.taglineWidth)
    const dividerX = left + drawnLeftColumnWidth + INLINE_COLUMN_GAP * scale
    context.save()
    context.fillStyle = GOLD
    context.shadowBlur = 10 * scale
    context.shadowColor = 'rgba(244, 198, 110, 0.55)'
    context.fillRect(dividerX, top + naturalHeight * scale * 0.1, Math.max(1, scale), naturalHeight * scale * 0.8)
    context.restore()

    const rightLeft = dividerX + INLINE_COLUMN_GAP * scale
    const rightTop = top + ((naturalHeight - rightColumnHeight) / 2) * scale
    fillPathsWithMarkGlow(
        context,
        WORDMARK_PATHS,
        rightLeft,
        rightTop,
        (WORDMARK_HEIGHT * scale) / WORDMARK_VIEWBOX.height,
        scale
    )
    drawAddress(
        context,
        typefaces,
        rightLeft,
        rightTop + (WORDMARK_HEIGHT + INLINE_GAP + ADDRESS_SIZE * 0.8) * scale,
        scale
    )
}

function drawBanner(context: CanvasRenderingContext2D, format: AssetFormat, typefaces: Typefaces): void {
    const area = format.contentArea
    if (area.width / area.height > WIDE_LAYOUT_ASPECT_RATIO) {
        drawInlineBanner(context, area, typefaces)
        return
    }
    drawStackedBanner(context, area, typefaces)
}

function drawCenteredIcon(context: CanvasRenderingContext2D, format: AssetFormat, glow: boolean, color: string): void {
    const iconWidth = format.width * SQUARE_MARK_WIDTH_RATIO
    const scale = iconWidth / ICON_VIEWBOX.width
    const left = (format.width - iconWidth) / 2
    const top = (format.height - ICON_VIEWBOX.height * scale) / 2

    if (glow) {
        fillPathsWithMarkGlow(context, ICON_PATHS, left, top, scale, format.width / 400)
        return
    }
    fillPaths(context, ICON_PATHS, left, top, scale, color)
}

/* ---------- entry point ---------- */

/** Renders one asset to a fresh canvas of exactly `format.width` x `format.height`. */
export async function renderAssetCanvas(format: AssetFormat, options: RenderOptions): Promise<HTMLCanvasElement> {
    await loadTypefaces(options.typefaces)

    const output = createCanvas(format.width, format.height)
    const context = output.getContext('2d')
    if (!context) throw new Error('2D canvas is unavailable')

    const hasBackdrop = format.look === 'banner' || format.look === 'mark-on-video'
    if (hasBackdrop) drawBackdrop(context, format.width, format.height, options)
    if (format.look === 'mark-on-white' || format.look === 'mark-on-black') {
        context.fillStyle = format.look === 'mark-on-white' ? '#ffffff' : '#000000'
        context.fillRect(0, 0, format.width, format.height)
    }

    if (format.look === 'banner') drawBanner(context, format, options.typefaces)
    if (format.look === 'mark-on-white') drawCenteredIcon(context, format, false, '#000000')
    if (format.look === 'mark-on-black') drawCenteredIcon(context, format, false, '#ffffff')
    if (format.look === 'mark-on-video') drawCenteredIcon(context, format, true, BONE)
    if (format.look === 'mark-light-mode') drawCenteredIcon(context, format, false, '#000000')
    if (format.look === 'mark-dark-mode') drawCenteredIcon(context, format, false, '#ffffff')
    return output
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png')
    })
}
