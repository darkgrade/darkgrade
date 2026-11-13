/**
 * Draws the Darkgrade lockup — the mark beside "Darkgrade" set in Public Sans — as SVG and PNG in
 * every colour combination the brand uses.
 *
 * The name is converted to outlines, so an SVG renders the same anywhere without the webfont. The
 * geometry mirrors the Lockup component in apps/darkgrade.com/app/components/wordmark.tsx: the mark
 * stands .82em tall beside the name, the gap is .4em, and the name is set at weight 500 with
 * -.035em tracking.
 */
import { Resvg } from '@resvg/resvg-js'
import * as fontkit from 'fontkit'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** The weight the name is set at, from the package rather than a path on one machine. */
const FONT_FILE = createRequire(import.meta.url).resolve(
    '@fontsource/public-sans/files/public-sans-latin-500-normal.woff'
)

const NAME = 'Darkgrade'
/** The size the name is set at inside the drawing; everything else is a share of it. */
const FONT_SIZE = 100
const MARK_HEIGHT_EM = 0.82
const GAP_EM = 0.4
const TRACKING_EM = -0.035
/** The mark, as apps/darkgrade.com/app/components/wordmark-paths.ts has it. */
const MARK_VIEWBOX = { width: 80, height: 56 }
const MARK_PATHS = [
    'M16 56H8V48H16V56ZM8 48H0V8H8V48ZM16 8H8V0H16V8Z',
    'M44 24H56V32H44V44H36V32H24V24H36V12H44V24Z',
    'M64 56H72V48H64V56ZM72 48H80V8H72V48ZM64 8H72V0H64V8Z',
]

const BONE = '#eae6dc'
const OBSIDIAN = '#0a0a0b'
const GOLD = '#f5cd8a'

/**
 * The name as one path, how wide it runs, and how far its ink reaches above and below the
 * baseline — the real outlines, not the face's metrics, so nothing is clipped and nothing is
 * padded. All at FONT_SIZE.
 */
function setName(): { path: string; width: number; above: number; below: number; capHeight: number } {
    const font = fontkit.openSync(FONT_FILE) as never as {
        unitsPerEm: number
        capHeight: number
        layout(text: string): {
            glyphs: { path: { toSVG(): string; bbox: { minY: number; maxY: number } } }[]
            positions: { xAdvance: number }[]
        }
    }
    const scale = FONT_SIZE / font.unitsPerEm
    const tracking = TRACKING_EM * FONT_SIZE
    const run = font.layout(NAME)

    let penX = 0
    let highest = 0
    let lowest = 0
    const pieces: string[] = []
    run.glyphs.forEach((glyph, index) => {
        const outline = glyph.path.toSVG()
        // fontkit draws in font units with y up; the drawing is y down, so each glyph is flipped and placed.
        if (outline) {
            pieces.push(`<path d="${outline}" transform="translate(${penX} 0) scale(${scale} ${-scale})" />`)
            highest = Math.max(highest, glyph.path.bbox.maxY * scale)
            lowest = Math.min(lowest, glyph.path.bbox.minY * scale)
        }
        penX += run.positions[index].xAdvance * scale + tracking
    })
    return {
        path: pieces.join(''),
        width: penX - tracking,
        above: highest,
        below: Math.abs(lowest),
        capHeight: font.capHeight * scale,
    }
}

const name = setName()
const markHeight = FONT_SIZE * MARK_HEIGHT_EM
const markWidth = (markHeight * MARK_VIEWBOX.width) / MARK_VIEWBOX.height
const gap = FONT_SIZE * GAP_EM
/* The mark is centred on the name's capitals, as the site sets it. The drawing is then trimmed to
   the ink: the mark reaches above the capitals, the descender of the g reaches below the baseline. */
const markTopFromBaseline = name.capHeight / 2 + markHeight / 2
const above = Math.max(name.above, markTopFromBaseline)
const below = Math.max(name.below, markHeight - markTopFromBaseline)
const height = above + below
const width = markWidth + gap + name.width
const baseline = above
const markTop = baseline - markTopFromBaseline

function lockupSVG(color: string, background: string | undefined, withMark: boolean): string {
    const markScale = markHeight / MARK_VIEWBOX.height
    const marks = MARK_PATHS.map(d => `<path d="${d}" />`).join('')
    // Each shape is trimmed to its own ink: with the mark the box follows the taller of the two, without it the name alone.
    const boxWidth = withMark ? width : name.width
    const boxAbove = withMark ? above : name.above
    const boxHeight = boxAbove + (withMark ? below : name.below)
    const nameLeft = withMark ? markWidth + gap : 0
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${round(boxWidth)}" height="${round(boxHeight)}" viewBox="0 0 ${round(boxWidth)} ${round(boxHeight)}" fill="none">`,
        background ? `<rect width="${round(boxWidth)}" height="${round(boxHeight)}" fill="${background}" />` : '',
        `<g fill="${color}">`,
        withMark ? `<g transform="translate(0 ${round(boxAbove - markTopFromBaseline)}) scale(${markScale})">${marks}</g>` : '',
        `<g transform="translate(${round(nameLeft)} ${round(boxAbove)})">${name.path}</g>`,
        `</g></svg>`,
    ].join('')
}

const round = (value: number) => Math.round(value * 100) / 100

/** Every ink the brand sets the name in, bare and on the two grounds it sits on. */
const INKS = [
    { suffix: 'dark', color: BONE, background: undefined, note: 'bone on transparent, for dark surfaces' },
    { suffix: 'light', color: OBSIDIAN, background: undefined, note: 'obsidian on transparent, for light surfaces' },
    { suffix: 'gold', color: GOLD, background: undefined, note: 'gold on transparent' },
    { suffix: 'on_obsidian', color: BONE, background: OBSIDIAN, note: 'bone on solid obsidian' },
    { suffix: 'on_white', color: OBSIDIAN, background: '#ffffff', note: 'obsidian on solid white' },
    { suffix: 'gold_on_obsidian', color: GOLD, background: OBSIDIAN, note: 'gold on solid obsidian' },
]

/** `combo` is the mark beside the name; `word` is the name on its own. The names the repos already use. */
const SHAPES = [
    { prefix: 'darkgrade_combo', withMark: true },
    { prefix: 'darkgrade_word', withMark: false },
]

/** PNGs are drawn at this width; a wordmark wants one generous size, not a ladder of them. */
const PNG_WIDTH = 1600

/** Everywhere the brand files are kept, relative to this app. They are copies of one another; nothing syncs them, so every one is written. */
const FOLDERS = ['public', '../drkgrd.co/public', '../docs/assets'].map(folder =>
    join(import.meta.dirname, '..', folder)
)

let written = 0
for (const shape of SHAPES) {
    for (const ink of INKS) {
        const file = `${shape.prefix}_${ink.suffix}`
        const svg = lockupSVG(ink.color, ink.background, shape.withMark)
        const png = new Resvg(svg, { fitTo: { mode: 'width', value: PNG_WIDTH } }).render().asPng()
        for (const folder of FOLDERS) {
            writeFileSync(join(folder, `${file}.svg`), `${svg}\n`)
            writeFileSync(join(folder, `${file}.png`), png)
        }
        written += 2
        console.log(`${file}  ${ink.note}`)
    }
}
console.log(`${written} files into each of ${FOLDERS.length} folders; the lockup is ${round(width)} x ${round(height)} at a ${FONT_SIZE}px name`)
