/** Decoded 640 × 480 Sony OSD frame; the caller supplies PNG decoding. */
export interface SonyKeyboardImage {
    width: number
    height: number
    rgba: Uint8Array
}

/** Each button press must finish by refreshing image(). Keep credential frames private. */
export interface SonyKeyboardControls {
    image: () => SonyKeyboardImage
    press: (button: 'up' | 'down' | 'left' | 'right' | 'enter') => Promise<unknown>
    text: (x: number, y: number, width: number, height: number, mode?: string) => Promise<string>
}

const keys = [
    { x: 30, y: 110, row: 0, column: 0 },
    { x: 327, y: 110, row: 0, column: 2 },
    { x: 475, y: 110, row: 0, column: 3 },
    ...Array.from({ length: 12 }, (_, index) => ({
        x: [30, 179, 327, 475][index % 4]!,
        y: [170, 230, 290][Math.floor(index / 4)]!,
        row: 1 + Math.floor(index / 4),
        column: index % 4,
    })),
    { x: 30, y: 415, row: 5, column: 0 },
    { x: 327, y: 415, row: 5, column: 2 },
    { x: 30, y: 350, row: 4, column: 0 },
    { x: 179, y: 350, row: 4, column: 1 },
]
const letters: Record<number, string> = {
    3: ".-_'@",
    4: 'abc',
    5: 'def',
    7: 'ghi',
    8: 'jkl',
    9: 'mno',
    11: 'pqrs',
    12: 'tuv',
    13: 'wxyz',
}
const numbers: Record<number, string> = {
    3: '1',
    4: '2',
    5: '3',
    7: '4',
    8: '5',
    9: '6',
    11: '7',
    12: '8',
    13: '9',
    17: '.',
    18: '0',
}
const symbols: Record<number, string> = {
    3: ".-_'@",
    4: '!?#',
    5: '$%&',
    7: '*+/',
    8: '=^`',
    9: '{|}~',
    11: '"(),',
    12: ';:<>',
    13: '[\\]',
}

function findCharacterInBank(character: string, values: Record<number, string>) {
    for (const [key, group] of Object.entries(values)) {
        const index = group.indexOf(character)
        if (index >= 0) return { key: Number(key), presses: index + 1 }
    }
}

/** Plan printable ASCII input without including input values in error messages. */
export function sonyWifiKeyboardCharacter(character: string) {
    if (character.length !== 1) throw new Error('Expected one Sony keyboard character')
    if (character === ' ') return { bank: 0, key: 14, presses: 1, uppercase: false }
    const uppercase = /^[A-Z]$/.test(character)
    for (const [bank, values] of [letters, numbers, symbols].entries()) {
        const match = findCharacterInBank(character.toLowerCase(), values)
        if (match) return { bank, ...match, uppercase }
    }
    throw new Error('The network contains a character unsupported by the Sony keyboard')
}

function pixel(image: SonyKeyboardImage, x: number, y: number) {
    const offset = (y * image.width + x) * 4
    return [image.rgba[offset]!, image.rgba[offset + 1]!, image.rgba[offset + 2]!]
}

function focusedKey(image: SonyKeyboardImage) {
    return keys.findIndex(key => {
        const [red, green, blue] = pixel(image, key.x + 10, key.y + 10)
        return red! > 150 && green! < 90 && blue! < 50
    })
}

function selectedBank(image: SonyKeyboardImage) {
    return [93, 171, 247].findIndex(x => {
        const [red, green, blue] = pixel(image, x, 153)
        return red! > 150 && green! > 90 && green! < 220 && blue! < 120
    })
}

function validateEmptyKeyboard(image: SonyKeyboardImage) {
    if (
        image.width !== 640 ||
        image.height !== 480 ||
        image.rgba.length !== 640 * 480 * 4 ||
        focusedKey(image) < 0 ||
        selectedBank(image) < 0
    ) {
        throw new Error('Camera did not present the validated Sony keyboard')
    }
    for (let y = 55; y < 92; y++) {
        for (let x = 45; x < 540; x++) {
            if (Math.min(...pixel(image, x, y)) > 170)
                throw new Error('The camera input field is not empty; cancel and clear it before provisioning')
        }
    }
}

async function focusKey(target: number, controls: SonyKeyboardControls) {
    for (let step = 0; step < 24; step++) {
        const current = focusedKey(controls.image())
        if (current === target) return
        if (current < 0) throw new Error('Sony keyboard focus could not be recognized')
        const source = keys[current]!
        const destination = keys[target]!
        const vertical = source.row > destination.row ? 'up' : 'down'
        const horizontal = source.column > destination.column ? 'left' : 'right'
        await controls.press(source.row !== destination.row ? vertical : horizontal)
    }
    throw new Error('Could not reach the requested Sony keyboard key')
}

async function selectBank(target: number, controls: SonyKeyboardControls) {
    for (let attempt = 0; selectedBank(controls.image()) !== target && attempt < 3; attempt++) {
        await focusKey(0, controls)
        await controls.press('enter')
    }
    if (selectedBank(controls.image()) !== target)
        throw new Error('Could not select the required Sony keyboard character bank')
}

/**
 * Enter text in an empty Sony Wi-Fi SSID/password keyboard, then select OK.
 * Validated on the English ILCE-6700 OSD. Network selection, secret delivery,
 * preview redaction, deadlines, and exclusive camera access belong to the caller.
 */
export async function typeSonyWifiKeyboard(value: string, controls: SonyKeyboardControls): Promise<void> {
    const planned = [...value].map(sonyWifiKeyboardCharacter)
    validateEmptyKeyboard(controls.image())
    for (const character of planned) {
        await selectBank(character.bank, controls)
        if (character.bank === 0) {
            const label = await controls.text(185, 176, 122, 35, '7')
            if (character.uppercase !== label.includes('ABC')) {
                await focusKey(10, controls)
                await controls.press('enter')
            }
        }
        await focusKey(character.key, controls)
        for (let index = 0; index < character.presses; index++) await controls.press('enter')
        await focusKey(2, controls)
        await controls.press('enter')
    }
    await focusKey(15, controls)
    await controls.press('enter')
}
