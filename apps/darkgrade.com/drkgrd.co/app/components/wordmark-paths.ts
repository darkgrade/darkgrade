/**
 * Geometry of the Darkgrade icon, shared by the on-page Lockup and the
 * social-image exporter so both always draw the same shapes.
 *
 * All paths live in one 80 x 56 coordinate space.
 */
export const ICON_VIEWBOX = { width: 80, height: 56 } as const

export const ICON_PATHS: readonly string[] = [
    'M16 56H8V48H16V56ZM8 48H0V8H8V48ZM16 8H8V0H16V8Z',
    'M44 24H56V32H44V44H36V32H24V24H36V12H44V24Z',
    'M72 56H64V48H72V56ZM80 48H72V8H80V48ZM72 8H64V0H72V8Z',
]

