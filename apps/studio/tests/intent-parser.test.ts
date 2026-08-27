import { normalizeTranscript, parseIntent, stripWakeWord } from '@voice/intent-parser'
import { replaceSpokenNumbers } from '@voice/number-words'
import { describe, expect, it } from 'vitest'

describe('replaceSpokenNumbers', () => {
    it.each([
        ['set iso to eight hundred', 'set iso to 800'],
        ['iso sixty four hundred', 'iso 6400'],
        ['iso one thousand six hundred', 'iso 1600'],
        ['iso twelve thousand eight hundred', 'iso 12800'],
        ['aperture two point eight', 'aperture 2.8'],
        ['aperture one point four', 'aperture 1.4'],
        ['shutter to one two hundred and fiftieth', 'shutter to 1 250th'],
        ['two hundred fiftieth of a second', '250th of a second'],
        ['one eight thousandth', '1 8000th'],
        ['half a second', 'half a second'],
        ['iso 400', 'iso 400'],
    ])('%s → %s', (input, expected) => {
        expect(replaceSpokenNumbers(input)).toBe(expected)
    })
})

describe('normalizeTranscript', () => {
    it('handles f-stop phrasing', () => {
        expect(normalizeTranscript('Set the F-stop to F/2.8.')).toContain('aperture')
    })
    it('joins spoken fractions', () => {
        expect(normalizeTranscript('shutter to 1 / 250')).toContain('1/250')
    })
})

describe('stripWakeWord', () => {
    it.each([
        ['In dark grade ISO 200', 'ISO 200'],
        ['A darkgrade, capture', 'capture'],
        ['and dark grade take a photo', 'take a photo'],
        ['Hey Darkgrade, take a photo', 'take a photo'],
        ['Hey, Dark Grade! take a photo', 'take a photo'],
        ['hey dark-grade take a photo', 'take a photo'],
        ['Darkgrade, take a photo', 'take a photo'],
        ['Studio, take a photo', 'take a photo'],
    ])('%s → %s', (input, stripped) => {
        expect(stripWakeWord(input)).toEqual({ stripped, hadWakeWord: true })
    })
    it('passes through without wake word', () => {
        expect(stripWakeWord('take a photo').hadWakeWord).toBe(false)
        // "camera" is no longer a wake word — it appears inside real commands
        expect(stripWakeWord('camera is busy').hadWakeWord).toBe(false)
    })
})

describe('parseIntent', () => {
    it.each([
        ['set iso to 800', 'set_iso', '800'],
        ['Set ISO to eight hundred', 'set_iso', '800'],
        ['ISO auto', 'set_iso', 'auto'],
        ['iso sixty four hundred', 'set_iso', '6400'],
        ['I said 200', 'set_iso', '200'],
        ['I said, 200.', 'set_iso', '200'],
        ['i so 400', 'set_iso', '400'],
        ['izzo 800', 'set_iso', '800'],
        ['I said auto', 'set_iso', 'auto'],
        ['I sell 100', 'set_iso', '100'],
        ['Shuttered 1 at 120th', 'set_shutter', '1/20'],
        ['shutters to 1/50', 'set_shutter', '1/50'],
        ['set the shutter speed to 1/250', 'set_shutter', '1/250'],
        ['shutter to one over 500', 'set_shutter', '1/500'],
        ['shutter speed two hundred and fiftieth of a second', 'set_shutter', '1/250'],
        ['set shutter to 2 seconds', 'set_shutter', '2'],
        ['shutter to half a second', 'set_shutter', '0.5'],
        ['shutter to a quarter of a second', 'set_shutter', '1/4'],
        ['set the shutter to bulb', 'set_shutter', 'bulb'],
        ['shutter speed 1/20th', 'set_shutter', '1/20'],
        ['shutter to 120th', 'set_shutter', '1/20'],
        ['120th of a second', 'set_shutter', '1/20'],
        ['shutter to 1/120', 'set_shutter', '1/120'],
        ['shutter to 110th', 'set_shutter', '1/10'],
        ['shutter to 1/60th', 'set_shutter', '1/60'],
        ['shutter to 160th', 'set_shutter', '1/60'],
        ['shutter to 160th of a second', 'set_shutter', '1/60'],
        ['shutter to 1/160', 'set_shutter', '1/160'],
        ['shutter to 1/160th', 'set_shutter', '1/160'],
        ['shutter to 115th', 'set_shutter', '1/15'],
        ['shutter to 18th', 'set_shutter', '1/8'],
        ['shutter to 125th', 'set_shutter', '1/125'],
        ['shutter to 1250th', 'set_shutter', '1/250'],
        ['shutter to 1000th', 'set_shutter', '1/1000'],
        ['shutter to 100th', 'set_shutter', '1/100'],
        ['shutter to 250', 'set_shutter', '1/250'],
        ['shutter to 8', 'set_shutter', '1/8'],
        ['chapter 1 250th', 'set_shutter', '1/250'],
        ['shudder speed to one sixtieth', 'set_shutter', '1/60'],
        ['set aperture to f/2.8', 'set_aperture', 'f/2.8'],
        ['aperture two point eight', 'set_aperture', 'f/2.8'],
        ['set the f-stop to four', 'set_aperture', 'f/4'],
        ['open the aperture to f 1.8', 'set_aperture', 'f/1.8'],
    ])('%s → %s %s', (input, intent, value) => {
        const parsed = parseIntent(input)
        expect(parsed?.intent).toBe(intent)
        expect(parsed?.value).toBe(value)
    })

    it.each([
        ['focus', 'focus'],
        ['Focus.', 'focus'],
        ['autofocus', 'focus'],
        ['refocus', 'focus'],
        ['grab focus', 'focus'],
        ['take a photo', 'capture'],
        ['Take a picture!', 'capture'],
        ['capture', 'capture'],
        ['shoot', 'capture'],
        ['start live view', 'liveview_start'],
        ['show me the live view', 'liveview_start'],
        ['stop the live view', 'liveview_stop'],
        ['turn off live view', 'liveview_stop'],
        ['start recording', 'record_start'],
        ['stop recording', 'record_stop'],
        ['cut', 'record_stop'],
        ['list the files', 'files_list'],
        ["what's on the card", 'files_list'],
        ['download everything', 'download_all'],
        ['download the latest photo', 'download_latest'],
        ['what are my settings', 'status'],
        ["what's the iso", 'status'],
        ['connect', 'connect'],
        ['connect to the camera', 'connect'],
        ['disconnect', 'disconnect'],
        ['fix the camera', 'kill_daemon'],
        ['the camera is busy', 'kill_daemon'],
        ['help', 'help'],
    ])('%s → %s', (input, intent) => {
        expect(parseIntent(input)?.intent).toBe(intent)
    })

    it.each([
        ['raise the iso', 'adjust_iso', '+3'],
        ['bump up the iso', 'adjust_iso', '+3'],
        ['lower the iso a little', 'adjust_iso', '-1'],
        ['drop the iso 2 stops', 'adjust_iso', '-6'],
        ['faster shutter', 'adjust_shutter', '-3'],
        ['make the shutter slower', 'adjust_shutter', '+3'],
        ['open up the aperture', 'adjust_aperture', '+3'],
        ['open the aperture a touch', 'adjust_aperture', '+1'],
        ['stop down', 'adjust_aperture', '-3'],
        ['close the aperture', 'adjust_aperture', '-3'],
        ['raise the exposure', 'adjust_exposure', '+3'],
        ['brighter', 'adjust_exposure', '+3'],
        ['darker', 'adjust_exposure', '-3'],
        ['lower the exposure two stops', 'adjust_exposure', '-6'],
    ])('%s → %s %s', (input, intent, value) => {
        const parsed = parseIntent(input)
        expect(parsed?.intent).toBe(intent)
        expect(parsed?.value).toBe(value)
    })

    it('explicit values still win over adjustment phrasing', () => {
        expect(parseIntent('raise the shutter to 1/250')).toMatchObject({ intent: 'set_shutter', value: '1/250' })
        expect(parseIntent('shutter speed to one sixtieth')).toMatchObject({ intent: 'set_shutter', value: '1/60' })
        expect(parseIntent('set iso to auto')).toMatchObject({ intent: 'set_iso', value: 'auto' })
    })

    it('returns null for unrelated speech', () => {
        expect(parseIntent('what a lovely day outside')).toBeNull()
        expect(parseIntent('')).toBeNull()
    })

    it('does not treat a question about iso as a set command', () => {
        expect(parseIntent('what is my iso')?.intent).toBe('status')
    })
})
