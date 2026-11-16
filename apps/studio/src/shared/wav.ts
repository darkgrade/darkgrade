export const SPEECH_SAMPLE_RATE = 16_000

/** A mono PCM16 WAV file around raw 16 kHz samples. */
export function wavFile(pcm: Uint8Array): Uint8Array<ArrayBuffer> {
    const file = new Uint8Array(44 + pcm.length)
    const header = new DataView(file.buffer)
    const writeText = (offset: number, text: string): void => {
        for (let index = 0; index < text.length; index++) header.setUint8(offset + index, text.charCodeAt(index))
    }
    writeText(0, 'RIFF')
    header.setUint32(4, 36 + pcm.length, true)
    writeText(8, 'WAVEfmt ')
    header.setUint32(16, 16, true)
    header.setUint16(20, 1, true)
    header.setUint16(22, 1, true)
    header.setUint32(24, SPEECH_SAMPLE_RATE, true)
    header.setUint32(28, SPEECH_SAMPLE_RATE * 2, true)
    header.setUint16(32, 2, true)
    header.setUint16(34, 16, true)
    writeText(36, 'data')
    header.setUint32(40, pcm.length, true)
    file.set(pcm, 44)
    return file
}
