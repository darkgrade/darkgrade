import type { MetadataRoute } from 'next'

const ORIGIN = 'https://darkgrade.com'

/** Everything may be crawled. The experiments under this domain publish their own sitemaps. */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: { userAgent: '*', allow: '/' },
        sitemap: [`${ORIGIN}/sitemap.xml`, `${ORIGIN}/docs/sitemap.xml`, ...['toolbench', 'voicebench', 'cambench'].map(path => `${ORIGIN}/${path}/sitemap.xml`)],
    }
}
