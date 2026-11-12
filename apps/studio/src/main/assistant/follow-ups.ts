import type { FoundRequest } from '@main/assistant/intent-schema'

/**
 * Short follow-ups ("little more", "too far", "undo that", "turn it off") only make sense against
 * what was just done, which the small model often loses track of: "little more" after warming made
 * the picture brighter. Studio knows exactly what it last did, so these are resolved here, exactly
 * and instantly. Anything that isn't plainly one of these goes to the model as usual.
 */

/** Words people put in front of a follow-up that don't change it. */
const FILLER = /^((okay|ok|alright|all right|actually|no|hmm|ah|um|uh|yeah|and|nah|oh)[,.!]?\s+)+/i

function normalise(sentence: string): string {
    return sentence
        .trim()
        .replace(/[.!?]+$/, '')
        .replace(FILLER, '')
        .replace(/[,]/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase()
}

const REPEAT =
    /^((a )?(little|bit|touch|tad|smidge) more|(a )?bit more|more|again|one more|same again|keep going|do it again)$/
const REVERSE_PHRASE =
    "((that's |it's |this is )?too (far|much)( back)?|back (a )?(bit|touch|little|tad)|(pull|bring) it back( (a )?(bit|touch|little))?|(a )?(bit|little|touch) less|less|overshot( it)?)"
/** One or more reversal phrases in a row: "too far, pull it back", "too much, back a touch". */
const REVERSE = new RegExp(`^${REVERSE_PHRASE}( ${REVERSE_PHRASE})*$`)
/** "Too warm, back a bit": a reversal that names what went too far; only valid when it matches. */
const REVERSE_NAMED =
    /^(that's |it's |this is |now it's )?too (warm|cool|cold|blue|orange|bright|dark)( (back|pull it back|bring it back)( (a )?(bit|touch|little))?)?$/
const UNDO = /^(undo( that| it)?|go back|put it back|revert( that)?|change it back)$/
const TURN_OFF = /^(turn|switch|shut) (it|that|them) off$|^(turn|switch) off$|^off$/

/** Which way each kind of named "too much" points: warm is +kelvin, bright is +stops. */
const NAMED_DIRECTION: Record<string, { action: FoundRequest['action']; sign: 1 | -1 }> = {
    warm: { action: 'adjust_color_temperature', sign: 1 },
    orange: { action: 'adjust_color_temperature', sign: 1 },
    cool: { action: 'adjust_color_temperature', sign: -1 },
    cold: { action: 'adjust_color_temperature', sign: -1 },
    blue: { action: 'adjust_color_temperature', sign: -1 },
    bright: { action: 'adjust_exposure', sign: 1 },
    dark: { action: 'adjust_exposure', sign: -1 },
}

function repeat(last: FoundRequest): FoundRequest | null {
    if (last.action === 'adjust_exposure' || last.action === 'adjust_color_temperature' || last.action === 'zoom')
        return { ...last }
    return null
}

function reverse(last: FoundRequest): FoundRequest | null {
    if (last.action === 'adjust_exposure' && last.stops) return { ...last, stops: -last.stops }
    if (last.action === 'adjust_color_temperature' && last.kelvin) return { ...last, kelvin: -last.kelvin }
    if (last.action === 'zoom') return { ...last, direction: last.direction === 'tele' ? 'wide' : 'tele' }
    return null
}

function turnOff(last: FoundRequest): FoundRequest | null {
    if (last.action === 'set_studio_view') {
        const off: FoundRequest = { action: 'set_studio_view' }
        if (last.focusPeaking) off.focusPeaking = false
        if (last.zebras) off.zebras = false
        return off.focusPeaking === false || off.zebras === false ? off : null
    }
    if (last.action === 'set_live_view' && last.on) return { action: 'set_live_view', on: false }
    return null
}

/** The request a follow-up sentence means, given what was done last (most recent last); null if it isn't one. */
export function resolveFollowUp(sentence: string, done: FoundRequest[]): FoundRequest | null {
    const text = normalise(sentence)
    const last = done.at(-1)
    if (UNDO.test(text)) return { action: 'undo_last_change' }
    if (!last) return null
    if (REPEAT.test(text)) return repeat(last)
    if (REVERSE.test(text)) return reverse(last)
    if (TURN_OFF.test(text)) return turnOff(last)
    const named = REVERSE_NAMED.exec(text)?.[2]
    const direction = named ? NAMED_DIRECTION[named] : undefined
    if (!direction || direction.action !== last.action) return null
    const amount = last.action === 'adjust_exposure' ? last.stops : last.kelvin
    // Only a reversal when the last step went the way they now say is too far.
    if (!amount || Math.sign(amount) !== direction.sign) return null
    return reverse(last)
}

/** A short line for the model's prompt: what was done, most recent last. */
export function describeDone(request: FoundRequest): string {
    switch (request.action) {
        case 'adjust_exposure':
            return `exposure ${request.stops! > 0 ? '+' : ''}${request.stops}`
        case 'adjust_color_temperature':
            return `warmth ${request.kelvin! > 0 ? '+' : ''}${request.kelvin}`
        case 'set_setting':
            return `set ${request.setting} ${request.value}`
        case 'set_studio_view':
            return `view ${[request.scope, request.zebras === undefined ? '' : `zebras-${request.zebras ? 'on' : 'off'}`, request.focusPeaking === undefined ? '' : `peaking-${request.focusPeaking ? 'on' : 'off'}`].filter(Boolean).join(' ')}`
        case 'set_recording':
            return `record ${request.on ? 'on' : 'off'}`
        case 'zoom':
            return `zoom ${request.direction === 'tele' ? 'in' : 'out'}`
        case 'take_photo':
            return 'photo'
        default:
            return request.action
    }
}
