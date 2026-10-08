'use client'

import dynamic from 'next/dynamic'

/**
 * Mounts the dev-only font chooser. The import sits behind a NODE_ENV check
 * that the bundler resolves at build time, so a production build contains no
 * chooser code at all rather than shipping it dormant.
 */
const DevFontChooser =
    process.env.NODE_ENV === 'development'
        ? dynamic(
              () =>
                  import('@/app/components/dev-font-chooser/dev-font-chooser').then(module => module.DevFontChooser),
              { ssr: false }
          )
        : null

export function DevTools() {
    return DevFontChooser ? <DevFontChooser /> : null
}
