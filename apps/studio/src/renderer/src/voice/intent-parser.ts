import { SHUTTER_VALUES } from '@renderer/lib/exposure-stops'
import { replaceSpokenNumbers } from '@voice/number-words'

/** Bumped on grammar changes — logged at startup so stale bundles are obvious. */
export const INTENT_PARSER_VERSION = 8

export type IntentName =
    | 'connect'
    | 'disconnect'
    | 'set_iso'
    | 'set_shutter'
    | 'set_aperture'
    | 'adjust_iso'
    | 'adjust_shutter'
    | 'adjust_aperture'
    | 'adjust_exposure'
    | 'focus'
    | 'capture'
    | 'liveview_start'
    | 'liveview_stop'
    | 'record_start'
    | 'record_stop'
    | 'files_list'
    | 'download_all'
    | 'download_latest'
    | 'status'
    | 'kill_daemon'
    | 'help'

export interface ParsedIntent {
    intent: IntentName
    /**
     * Normalized argument. Set intents: '800', '1/250', 'f/2.8'.
     * Adjust intents: signed third-stop steps toward MORE light, e.g. '+3'
     * (one stop brighter) or '-1' (a third-stop darker).
     */
    value?: string
    /** The normalized transcript the intent was parsed from */
    normalized: string
}

// "hey darkgrade" — tolerant of Whisper's spellings: "Hey, Dark Grade!",
// "hey dark-grade", "In dark grade …", "A darkgrade …". Any single short
// word may precede the name (Whisper regularly garbles "hey"); the name
// itself is still required. "studio" also accepted.
const WAKE_WORD_PATTERN = /^(?:[a-z]{1,6}[\s,]+)?(?:dark[\s,-]*grade|studio)[\s,.!:-]*/i

export function stripWakeWord(text: string): { stripped: string; hadWakeWord: boolean } {
    const match = text.match(WAKE_WORD_PATTERN)
    if (match && match[0].trim().length > 0) {
        return { stripped: text.slice(match[0].length), hadWakeWord: true }
    }
    return { stripped: text, hadWakeWord: false }
}

export function normalizeTranscript(raw: string): string {
    let text = raw.toLowerCase()
    // Whisper artifacts
    text = text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    // Contractions: "what's" → "whats" (apostrophes vanish, not become spaces)
    text = text.replace(/['’`]/g, '')
    // Spoken symbols
    text = text.replace(/\bslash\b/g, '/')
    text = text.replace(/\bf[\s-]?stop\b/g, 'aperture')
    text = text.replace(/\bf[\s/]+(\d)/g, 'f$1')
    // Punctuation (keep / . for fractions and decimals)
    text = text.replace(/[^a-z0-9/.\s-]/g, ' ')
    text = text.replace(/-/g, ' ')
    text = replaceSpokenNumbers(text)
    // "1 / 250" → "1/250"
    text = text.replace(/(\d)\s*\/\s*(\d)/g, '$1/$2')
    // Whisper mishears "ISO": "I said 200", "I sell 100", "I so 400", "izzo"
    text = text.replace(/\bi\s+(?:said|say|says|so|saw|sew|zo|sell|cell|sold)\b(?=\s+(?:to\s+)?(?:\d|auto))/g, 'iso')
    text = text.replace(/\b(?:isso|izzo|eso|ezo|iso)\b/g, 'iso')
    return text.replace(/\s+/g, ' ').trim()
}

/**
 * Whisper merges spoken numerators into ordinals: "one sixtieth" → "160th",
 * "one twentieth" → "120th", "one eighth" → "18th". Disambiguation for a
 * slash-less ordinal "1R…th":
 *   1. If the merged number isn't a real shutter denominator but R is, the 1
 *      was the spoken numerator → strip it ("120th" → 20; 1/120 doesn't exist).
 *   2. If both are real, prefer R when it's a classic FULL stop
 *      ("160th" → 60) but keep the merged value otherwise ("125th" → 125,
 *      since "one twenty-fifth" almost always means 1/125).
 * Explicit fractions ("1/160") never pass through this at all.
 */
const SHUTTER_DENOMINATORS = new Set(
    SHUTTER_VALUES.filter(value => value.includes('/')).map(value => parseInt(value.split('/')[1], 10))
)
const FULL_STOP_DENOMINATORS = new Set([2, 4, 8, 15, 30, 60, 125, 250, 500, 1000, 2000, 4000, 8000])

function normalizeOrdinalDenominator(rawDenominator: string): string {
    if (rawDenominator.length < 2 || !rawDenominator.startsWith('1')) return rawDenominator
    const remainder = rawDenominator.slice(1)
    if (remainder.startsWith('0')) return rawDenominator // 100th, 1000th
    const remainderNumber = parseInt(remainder, 10)
    const mergedNumber = parseInt(rawDenominator, 10)
    if (!SHUTTER_DENOMINATORS.has(remainderNumber)) return rawDenominator
    if (!SHUTTER_DENOMINATORS.has(mergedNumber)) return remainder
    if (FULL_STOP_DENOMINATORS.has(remainderNumber)) return remainder
    return rawDenominator
}

function parseShutterValue(text: string): string | null {
    if (/\bbulb\b/.test(text)) return 'bulb'

    // "1/250", "1/60th", "1/250 of a second" — explicit slash: trust the
    // denominator exactly as spoken (so "1/160" stays 1/160).
    const fraction = text.match(/\b(\d+)\/(\d+)(?:st|nd|rd|th)?\b/)
    if (fraction) return `${fraction[1]}/${fraction[2]}`

    // "1 over 250", "one over 250"
    const over = text.match(/\b(\d+)\s+over\s+(\d+)\b/)
    if (over) return `${over[1]}/${over[2]}`

    // "250th (of a second)", "1 250th", "160th" (= spoken "one sixtieth")
    const ordinal = text.match(/\b(?:1\s+)?(\d+)th\b/)
    if (ordinal) return `1/${normalizeOrdinalDenominator(ordinal[1])}`

    // "half a second", "quarter of a second"
    if (/\bhalf\b/.test(text)) return '0.5'
    if (/\bquarter\b/.test(text)) return '1/4'

    // "2 seconds", "0.5 seconds", "2s"
    const seconds = text.match(/\b(\d+(?:\.\d+)?)\s*(?:s\b|sec\b|secs\b|second\b|seconds\b)/)
    if (seconds) return seconds[1]

    // Bare number as a last resort: photographer shorthand is fractional —
    // "shutter to 250" → 1/250, "shutter to 8" → 1/8. Whole/decimal seconds
    // require the word ("2 seconds", "0.5 seconds"), handled above.
    const bare = text.match(/\b(\d+(?:\.\d+)?)\b/)
    if (bare) {
        if (bare[1].includes('.')) return bare[1]
        return `1/${bare[1]}`
    }

    return null
}

function parseApertureValue(text: string): string | null {
    const fSlash = text.match(/\bf\s*\/?\s*(\d+(?:\.\d+)?)\b/)
    if (fSlash) return `f/${fSlash[1]}`
    const bare = text.match(/\b(\d+(?:\.\d+)?)\b/)
    if (bare) return `f/${bare[1]}`
    return null
}

function parseIsoValue(text: string): string | null {
    if (/\bauto\b/.test(text)) return 'auto'
    const value = text.match(/\b(\d{2,6})\b/)
    if (value) return value[1]
    return null
}

// ------------------------------------------------------ relative adjustments

const STEPS_PER_STOP = 3
/** An explicit value means the user wants set, not adjust — fall through. */
const EXPLICIT_VALUE_PATTERN = /\d\/\d|\bf\/?\d|\b\d{3,6}\b|\bbulb\b|\bauto\b/

/** "two stops" scales; "a little / a touch / a third" = one third-stop. */
function parseStepCount(text: string): number {
    const stops = text.match(/\b(\d)\s*(?:full\s*)?stops?\b/)
    if (stops) return parseInt(stops[1], 10) * STEPS_PER_STOP
    if (/\b(?:slightly|a\s+little|a\s+touch|a\s+bit|a\s+third)\b/.test(text)) return 1
    return STEPS_PER_STOP
}

/** Signed third-stop steps toward MORE light: '+3' = one stop brighter. */
function parseAdjustment(text: string, morePattern: RegExp, lessPattern: RegExp): string | null {
    if (EXPLICIT_VALUE_PATTERN.test(text)) return null
    let direction: 1 | -1
    if (morePattern.test(text)) direction = 1
    else if (lessPattern.test(text)) direction = -1
    else return null
    return `${direction > 0 ? '+' : '-'}${parseStepCount(text)}`
}

const parseIsoAdjustment = (text: string): string | null =>
    parseAdjustment(
        text,
        /\b(?:raise|increase|boost|bump|crank|higher|up)\b/,
        /\b(?:lower|decrease|drop|reduce|down)\b/
    )

// For shutter, faster = shorter exposure = LESS light.
// NOTE: no bare "speed" — "shutter speed to …" must fall through to set.
const parseShutterAdjustment = (text: string): string | null =>
    parseAdjustment(
        text,
        /\b(?:slower|slow|longer|lengthen|lower|decrease|drop|down)\b/,
        /\b(?:faster|quicker|shorter|raise|increase|speed\s+up|up)\b/
    )

// For aperture, open = wider = MORE light; "raise/higher" means a higher
// f-number. "stop down" is checked before generic direction words.
const parseApertureAdjustment = (text: string): string | null => {
    if (EXPLICIT_VALUE_PATTERN.test(text)) return null
    if (/\bstop\s+down\b/.test(text)) return `-${parseStepCount(text)}`
    return parseAdjustment(
        text,
        /\b(?:open|wider|widen|lower|decrease|drop)\b/,
        /\b(?:close|closed|narrow|smaller|raise|increase|higher)\b/
    )
}

const parseExposureAdjustment = (text: string): string | null =>
    parseAdjustment(
        text,
        /\b(?:raise|increase|boost|bump|brighte[rn]|lighter|up|more)\b/,
        /\b(?:lower|decrease|drop|reduce|darke[rn]|dimmer|down|less)\b/
    )

interface IntentRule {
    intent: IntentName
    pattern: RegExp
    extractValue?: (text: string) => string | null
}

/** Ordered: first match wins, so settings rules run before generic capture verbs. */
const INTENT_RULES: IntentRule[] = [
    // Relative adjustments run first; their extractors bail when an explicit
    // value is present so "shutter to 1/250" still reaches the set rules.
    { intent: 'adjust_iso', pattern: /\biso\b/, extractValue: parseIsoAdjustment },
    {
        intent: 'adjust_shutter',
        pattern: /\b(?:shutter(?:ed|s)?|shudder(?:ed)?|chapter)(?:\s*speed)?\b/,
        extractValue: parseShutterAdjustment,
    },
    {
        intent: 'adjust_aperture',
        pattern: /\baperture\b|\bstop\s+down\b|\bopen\s+up\b/,
        extractValue: parseApertureAdjustment,
    },
    {
        intent: 'adjust_exposure',
        pattern: /\bexposure\b|\bbrighte[rn]\b|\bdarke[rn]\b|\b(?:lighter|dimmer)\b/,
        extractValue: parseExposureAdjustment,
    },
    { intent: 'set_iso', pattern: /\biso\b/, extractValue: parseIsoValue },
    // "shuttered"/"shudder"/"chapter" are common Whisper mishearings of
    // "shutter"; a bare "Xth of a second" is unambiguously a shutter speed.
    {
        intent: 'set_shutter',
        pattern: /\b(?:shutter(?:ed|s)?|shudder(?:ed)?|chapter)(?:\s*speed)?\b|\bexposure\s+time\b|\bof\s+a\s+second\b/,
        extractValue: parseShutterValue,
    },
    { intent: 'set_aperture', pattern: /\baperture\b|\bf\/?\d/, extractValue: parseApertureValue },
    {
        intent: 'record_start',
        pattern:
            /\b(?:start|begin)\b.*\b(?:recording|video|filming)\b|\bstart\s+record\b|\broll(?:ing)?\s+(?:video|camera)\b|\baction\b/,
    },
    { intent: 'record_stop', pattern: /\b(?:stop|end|finish)\b.*\b(?:recording|video|filming)\b|\bcut\b(?!\w)/ },
    {
        intent: 'liveview_start',
        pattern:
            /\b(?:start|show|open|begin|enable|turn\s+on)\b.*\blive\s*(?:view|feed|preview)\b|\blive\s*view\s+on\b/,
    },
    {
        intent: 'liveview_stop',
        pattern:
            /\b(?:stop|hide|close|end|disable|turn\s+off)\b.*\blive\s*(?:view|feed|preview)\b|\blive\s*view\s+off\b/,
    },
    { intent: 'download_all', pattern: /\bdownload\b.*\b(?:all|everything|every\s+file)\b|\bdownload\s+the\s+card\b/ },
    { intent: 'download_latest', pattern: /\b(?:download|save|get|grab)\b.*\b(?:latest|last|newest|recent)\b/ },
    {
        intent: 'files_list',
        pattern:
            /\b(?:list|show|refresh|read)\b.*\b(?:files|photos|pictures|images|card|storage)\b|\bwhat(?:s|\s+is)?\s+on\s+the\s+card\b/,
    },
    { intent: 'focus', pattern: /\b(?:re)?focus\b|\bauto\s?focus\b|\baf\b|\bhalf\s?press\b/ },
    {
        intent: 'capture',
        pattern:
            /\b(?:take|capture|snap|shoot|grab)\b.*\b(?:photo|picture|shot|image|frame|one)\b|\bcapture\b|\bshoot\b|\bfire\b|\bcheese\b|\btake\s+it\b/,
    },
    {
        intent: 'status',
        pattern:
            /\bstatus\b|\bsettings\b|\bwhat(?:s|\s+is)\s+(?:the|my)\s+(?:iso|aperture|shutter|exposure)\b|\bread\s+(?:the\s+)?(?:settings|exposure)\b/,
    },
    { intent: 'disconnect', pattern: /\bdisconnect\b|\brelease\s+the\s+camera\b/ },
    { intent: 'connect', pattern: /\b(?:connect|reconnect)\b/ },
    {
        intent: 'kill_daemon',
        pattern:
            /\b(?:fix|free|unstick|unblock)\b.*\bcamera\b|\bkill\b.*\b(?:daemon|process|mac|ptp)\b|\bcamera\s+(?:is\s+)?busy\b/,
    },
    { intent: 'help', pattern: /\bhelp\b|\bwhat\s+can\s+(?:i|you)\s+(?:say|do)\b|\bcommands\b/ },
]

export function parseIntent(rawTranscript: string): ParsedIntent | null {
    const normalized = normalizeTranscript(rawTranscript)
    if (!normalized) return null

    for (const rule of INTENT_RULES) {
        if (!rule.pattern.test(normalized)) continue
        if (rule.extractValue) {
            // Strip the subject word before extracting so "iso 800" doesn't
            // read digits out of unrelated words.
            const value = rule.extractValue(normalized)
            if (value === null) continue
            return { intent: rule.intent, value, normalized }
        }
        return { intent: rule.intent, normalized }
    }
    return null
}

export const VOICE_COMMAND_EXAMPLES: Array<{ phrase: string; action: string }> = [
    { phrase: '"connect" / "disconnect"', action: 'Connect or release the camera' },
    { phrase: '"set ISO to 800" / "ISO auto"', action: 'Change ISO' },
    { phrase: '"shutter to 1/250" / "shutter to 2 seconds" / "shutter to bulb"', action: 'Change shutter speed' },
    { phrase: '"aperture to f/2.8" / "f-stop 4"', action: 'Change aperture' },
    {
        phrase: '"raise the ISO" / "faster shutter" / "open the aperture" / "brighter" / "darker two stops"',
        action: 'Step exposure up or down',
    },
    { phrase: '"focus" / "autofocus"', action: 'Half-press autofocus' },
    { phrase: '"take a photo" / "capture" / "shoot"', action: 'Capture an image' },
    { phrase: '"start live view" / "stop live view"', action: 'Toggle live view' },
    { phrase: '"start recording" / "stop recording" / "cut"', action: 'Toggle video recording' },
    { phrase: '"list files" / "what\'s on the card"', action: 'Browse camera storage' },
    { phrase: '"download everything" / "download the latest"', action: 'Download files' },
    { phrase: '"what are my settings"', action: 'Read current exposure' },
    { phrase: '"fix the camera"', action: 'Kill the macOS camera daemon' },
]
