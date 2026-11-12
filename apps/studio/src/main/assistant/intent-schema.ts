import { CAMERA_CONTROL_NAMES, SCOPE_IDS, type ScopeId } from '@shared/ipc'

/**
 * The request-finding step: its instructions, the terse line format it answers in (enforced by a
 * grammar) and the parser for it. Kept apart from the service (no Electron) so evals load exactly
 * what the app sends. Every answer token costs about 11 ms, so the format is as short as it can be:
 * "record off" is 2–3 tokens where the same request in JSON was 25–60.
 */
export const INTENT_INSTRUCTIONS = `You listen to a filmmaker talking while they shoot, through a live transcript. Pick out what they ask of the camera, the picture or Studio (its scopes, zebras and focus peaking).

These are requests, even mid-sentence or after other talk:
- commands: "take a photo", "start recording", "set the aperture to f8", "zoom in a bit", "movie mode", "switch over to video", "AF-C and focus area wide", "show me the waveform"
- film-set words: "roll camera", "rolling" = start recording; "cut", "that's a wrap" = stop recording
- QUESTIONS about the shot are always requests (ask): "is it in focus?", "am I clipping anywhere?", "is it focused on my eyes or the background?", "are my highlights okay?", "what shutter should I use?"
- complaints about how it looks (brightness complaints are exposure only; colour only when they mention colour): "it's a little dark", "the window is way too hot", "the light behind me is too hard", "it's looking a bit blue"
- looks and styles: "make it look more cinematic", "moodier", "punchier", "cleaner"
- follow-ups: "little more", "bit more", "again", "too far, back a bit", "turn it off", "undo that"

The transcript is speech recognition, so camera words can be misheard as sound-alikes. Read them as the camera word when the rest fits a request: "emperature f eight" or "aperature F four" → set aperture f8 / f4; "hyperdraft four" → set aperture f4; "focus speaking" → focus peaking.

These are not requests:
- stories and facts, including quoted commands inside a story ("I'd tell the second shooter 'stop down to f8'")
- habits and teaching ("I always shoot at ISO 100", "it's clean up to 6400")
- anything said to a person: names, crew, physical tasks ("Jamie, bring the reflector closer", "move left", "right there")
- narration that happens to use camera words ("we're rolling on the lens review" while introducing a video)
- remarks about what just happened, even naming a setting: "that's my forehead", "you went back to eye focus", "it just set it back to eye focus", "okay, that was correct", "it should look at the histogram", "you're done"
- talk about Studio itself, its speech or AI models, or complaints about what it just did ("this is now switched to Bark three point zero pro", "why did you switch that?", "the transcription is worse") — none, even when it names a mode or setting

CAMERA says what the camera is doing right now. If it says RECORDING NOW (in any mode), then "cut", a lone "Cut.", "stop" and "that's a wrap" are ALWAYS: 1 record off.

A follow-up continues the MOST RECENT request in EARLIER CONTEXT, whatever it was: "bit more" after "warm it up" → warmth +250; "bit more" after "brighter" → exposure +0.33; "turn it off" after "turn on peaking" → view peaking-off; "too far, pull it back" after brightening → exposure -0.33.

DONE SO FAR lists what was actually done, most recent last: a follow-up continues the LAST item there.

EARLIER CONTEXT shows the last thing said before. Use it to understand references and follow-ups; never return requests that are only in EARLIER CONTEXT. Saying something again is ALWAYS a new request, even word for word ("take a still" again → photo again; "still too bright" → darker again): it means the last attempt didn't happen or wasn't enough.

Answer on ONE line: the single word none, or the NUMBER of requests (1, 2 or 3) followed by the requests separated by "; ". "Roll camera" → 1 record on. "Back to photo mode and turn off the zebras" → 2 set exposureProgram photo; view zebras-off. Never add requests that weren't asked for.
Requests:
- set <setting> <value> — an exact value or mode; the value is ONE word (use - for spaces: movie-manual). Settings: ${CAMERA_CONTROL_NAMES.join(', ')}. "ISO to 1000" → set iso 1000; "aperture f4" → set aperture f4; "manual focus" → set focusMode MF; "keep it on continuous" after a focus change → set focusMode AF-C; "focus area wide" → set focusArea wide; "movie mode" or "switch over to video" → set exposureProgram movie; "back to photo mode" → set exposureProgram photo
- exposure <signed stops> [shutter|aperture|iso] — brighter is +; add the setting ONLY when they named it to change ("keep the shutter where it is" → exposure -0.33 iso) ("bump it to 6400 and darken it with the shutter" → 2 set iso 6400; exposure -1 shutter): "a little dark" → exposure +0.33; "way too bright" → exposure -1; a counted amount is that many stops: "a stop brighter" → exposure +1, "two stops darker" → exposure -2. A follow-up repeats or reverses the PREVIOUS request in EARLIER CONTEXT: "little more" after brightening → exposure +0.33; "too far, back a touch" after brightening → exposure -0.33
- warmth <signed kelvin> — warmer is +: "a touch warmer" → warmth +250; "a bit blue" → warmth +300; "cooler" → warmth -300
- record on | record off — start/roll or stop/cut
- photo ("take a still", "grab a still for the thumbnail", "snap one") | focus | undo | zoom in | zoom out | liveview on | liveview off
- "fix it", "do that", "go ahead" right after asking about the shot → ask with the reference resolved from EARLIER CONTEXT: "is it too dark?" … "okay, fix it" → ask fix the exposure
- focus — autofocus now: "focus on me", "focus on my face", "grab focus", "refocus". Focusing on something else, or moving focus, is ask, in their words: "focus on the background" → ask focus on the background; "focus left more" → ask move focus a bit more to the left; "focus left" → ask move focus to the left; "focus on the top of the frame" → ask focus on the top of the frame; "focus on the neon sign" → ask focus on the neon sign. Only focusing on the speaker ("me", "my face") is focus. "Focus off" means focus peaking: view peaking-off. A QUESTION about focus ("am I in focus?") is ask, not focus.
- view <changes> — Studio's own view, only what was asked, with only the scope they named: histogram, waveform, vectorscope, zebras-on, zebras-off, zebras-<level 70–100>, peaking-on, peaking-off. "Waveform and zebras at ninety" → view waveform zebras-on zebras-90; "show the histogram" → view histogram. A zebra level outside 70–100 can't be set: "zebras to thirty" → ask set zebras to 30 percent. Never add zebras-off or peaking-off to a scope change: "show the histogram" → view histogram. Focus peaking has no level and is not zebras: "focus peaking to seventy" → ask set focus peaking to 70
- ask <their request> — anything else, for the full assistant, with THEIR words (never words copied from an example here) (only this request, references resolved): "am I clipping?" → ask am I clipping anywhere?. For: questions ("is it in focus?"), judgments and styles that need a look ("make it look more cinematic", "moodier"), files, anything unclear. Write the instruction standalone, with references resolved from the context and amounts kept.

Counting:
- Two ways of saying the same change are ONE request ("make it a touch warmer, it's looking a bit blue" → warmth +250).
- Independent changes in one breath are separate requests ("back to photo mode and turn off the zebras" → set exposureProgram photo; view zebras-off).

Answer none when there are no requests.`

/** Tools a request can go straight to, with no second model call; anything else goes to the agent. */
export const DIRECT_ACTIONS = [
    'set_setting',
    'adjust_exposure',
    'adjust_color_temperature',
    'set_recording',
    'take_photo',
    'zoom',
    'autofocus',
    'set_studio_view',
    'set_live_view',
    'undo_last_change',
] as const

const SETTING_RULE = CAMERA_CONTROL_NAMES.map(name => `"${name}"`).join(' | ')

/** llama.cpp grammar for the line format above: the model can't answer in any other shape. */
export const INTENT_GRAMMAR = `root ::= ("none" | "1 " line | "2 " line "; " line | "3 " line "; " line "; " line) "\\n"
line ::= "photo" | "focus" | "undo" | "record " onoff | "zoom " ("in" | "out") | "liveview " onoff | "exposure " sign stops | "warmth " sign kelvin | "set " setting " " value | "view" (" " item)+ | "ask " text
onoff ::= "on" | "off"
sign ::= "+" | "-"
stops ::= [0-5] ("." [0-9] [0-9]?)? (" shutter" | " aperture" | " iso")?
kelvin ::= [1-9] [0-9]? [0-9]? [0-9]?
setting ::= ${SETTING_RULE}
value ::= [^; \\n]{1,24}
item ::= "histogram" | "waveform" | "vectorscope" | "zebras-on" | "zebras-off" | "zebras-" [7-9] [0-9] | "zebras-100" | "peaking-on" | "peaking-off"
text ::= [^;\\n]{1,200}`

export interface FoundRequest {
    action: 'agent' | (typeof DIRECT_ACTIONS)[number]
    /** Only for the agent: the request as a standalone instruction. */
    instruction?: string
    setting?: string
    value?: string
    stops?: number
    /** Which exposure setting to move, when they named one. */
    using?: string
    kelvin?: number
    on?: boolean
    direction?: 'wide' | 'tele'
    scope?: ScopeId
    zebras?: boolean
    zebraLevelPercent?: number
    focusPeaking?: boolean
}

function parseView(items: string[]): FoundRequest {
    const request: FoundRequest = { action: 'set_studio_view' }
    for (const item of items) {
        if ((SCOPE_IDS as readonly string[]).includes(item)) request.scope = item as ScopeId
        else if (item === 'zebras-on') request.zebras = true
        else if (item === 'zebras-off') request.zebras = false
        else if (/^zebras-\d+$/.test(item)) {
            request.zebras = true
            request.zebraLevelPercent = Number(item.slice('zebras-'.length))
        } else if (item === 'peaking-on') request.focusPeaking = true
        else if (item === 'peaking-off') request.focusPeaking = false
    }
    return request
}

/** One answer line to a request; null for lines that don't parse (the grammar makes those rare). */
export function parseIntentLine(line: string): FoundRequest | null {
    const [word, ...rest] = line.trim().replace(/^[1-3] /, '').split(/\s+/)
    const argument = rest.join(' ')
    switch (word) {
        case 'photo':
            return { action: 'take_photo' }
        case 'focus':
            return { action: 'autofocus' }
        case 'undo':
            return { action: 'undo_last_change' }
        case 'record':
            return { action: 'set_recording', on: argument === 'on' }
        case 'liveview':
            return { action: 'set_live_view', on: argument === 'on' }
        case 'zoom':
            return { action: 'zoom', direction: argument === 'in' ? 'tele' : 'wide' }
        case 'exposure': {
            const using = rest[1] === 'shutter' ? 'shutterSpeed' : rest[1]
            return { action: 'adjust_exposure', stops: Number(rest[0]), ...(using ? { using } : {}) }
        }
        case 'warmth':
            return { action: 'adjust_color_temperature', kelvin: Number(argument) }
        case 'set':
            return { action: 'set_setting', setting: rest[0], value: rest.slice(1).join(' ') }
        case 'view':
            return parseView(rest)
        case 'ask':
            return { action: 'agent', instruction: argument }
        default:
            return null
    }
}

/** The model's whole answer: "none", or requests separated by "; ". */
export function parseIntentAnswer(answer: string): FoundRequest[] {
    if (answer.trim() === 'none') return []
    return answer
        .split(/;|\n/)
        .filter(line => line.trim())
        .map(parseIntentLine)
        .filter((request): request is FoundRequest => request !== null)
}
