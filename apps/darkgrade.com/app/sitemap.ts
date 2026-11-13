import type { MetadataRoute } from 'next'

const ORIGIN = 'https://darkgrade.com'

/** This site's own pages; each experiment lists its pages in /<experiment>/sitemap.xml (see robots.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
    return ['/', '/toolbench/', '/voicebench/', '/cambench/'].map(path => ({ url: `${ORIGIN}${path}` }))
}
