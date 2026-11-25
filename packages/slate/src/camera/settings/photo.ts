import { settingReader, type SettingReaders, type SettingTypes } from '@camera/settings/setting-types'
import type { CanonImageFormat, CanonImageFormatLabel } from '@vendors/canon/datasets/canon-image-format-dataset'
import type { SonyImageSize } from '@vendors/sony/definitions/sony-property-definitions'
import type { CodecType } from '@ptp/types/codec'
import type { CodecValue } from '@vendors/control-properties'

/** Photo settings. Canonical ids, labels and search aliases. */
export const photoControlDefinitions = {
    photoFormat: {
        label: 'Photo format',
        aliases: ['still format', 'stillFormat', 'image format', 'imageFormat', 'file format', 'file type', 'image quality'],
    },
    photoSize: { label: 'Photo size', aliases: ['image size', 'imageSize'] },
    aspectRatio: { label: 'Aspect ratio', aliases: ['aspect ratio'] },
    jpegQuality: { label: 'JPEG quality', aliases: ['jpeg quality'] },
    rawCompression: { label: 'RAW compression', aliases: ['raw compression', 'NEF compression', 'raw file type'] },
    flashMode: { label: 'Flash', aliases: ['flash mode', 'flash'] },
} as const

/**
 * A photo format, in each vendor codec's own spelling: `'RAW'`, `'RAW+JPEG'`, `'JPEG'` on current
 * Sony bodies; format and quality together (`'RAW+JPEG Fine'`, `'HEIF Standard'`) on Sony bodies
 * with one combined setting; Canon's format with its size (`'RAW'`, `'cRAW+L'`, `'M'`).
 */
export type PhotoFormat = Exclude<CodecValue<'photoFormat'>, CanonImageFormat> | CanonImageFormatLabel

/**
 * The standard ImageSize property is a free-form string, which collapses the codec union to
 * `string`; Sony's enumerated size names come from its own codec instead.
 */
type EnumeratedPhotoSize = CodecType<(typeof SonyImageSize)['codec']>

/** A photo size: Sony's codec names (`'Large'`, `'Medium'`, `'Small'`), or the pixel dimensions a standard body lists. */
export type PhotoSize = Exclude<CodecValue<'photoSize'>, string> | EnumeratedPhotoSize | `${number}x${number}`

export type AspectRatio = CodecValue<'aspectRatio'>
export type JpegQuality = CodecValue<'jpegQuality'>
export type RawCompression = CodecValue<'rawCompression'>
export type FlashMode = CodecValue<'flashMode'>

/** Value types of this group's typed settings: each id gets `get<Id>()` and `set<Id>(value)` on Camera. */
export interface PhotoSettingTypes {
    photoFormat: SettingTypes<PhotoFormat>
    photoSize: SettingTypes<PhotoSize>
    aspectRatio: SettingTypes<AspectRatio>
    jpegQuality: SettingTypes<JpegQuality>
    rawCompression: SettingTypes<RawCompression>
    flashMode: SettingTypes<FlashMode>
}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const photoSettingReaders: SettingReaders<PhotoSettingTypes> = {
    photoFormat: settingReader<PhotoFormat>(),
    photoSize: settingReader<PhotoSize>(),
    aspectRatio: settingReader<AspectRatio>(),
    jpegQuality: settingReader<JpegQuality>(),
    rawCompression: settingReader<RawCompression>(),
    flashMode: settingReader<FlashMode>(),
}
