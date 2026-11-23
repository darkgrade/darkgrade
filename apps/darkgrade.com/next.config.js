/** Separate Vercel apps served under darkgrade.com at /<path>/. */
const EXPERIMENTS = [
    { path: 'toolbench', origin: 'https://toolbench-gilt.vercel.app' },
    { path: 'voicebench', origin: 'https://voicebench-six.vercel.app' },
    { path: 'cambench', origin: 'https://cambench.vercel.app' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
    // The experiments' canonical URLs end in a slash; Next's default slash-stripping redirect would bounce them.
    skipTrailingSlashRedirect: true,
    // Keep indexed documentation addresses working after the Slate rename.
    async redirects() {
        return [
            { source: '/docs/link', destination: '/docs/slate', permanent: true },
            { source: '/docs/link/:page*', destination: '/docs/slate/:page*', permanent: true },
            ...['getting_started', 'ptp-reference'].map(section => ({
                source: `/docs/${section}/:page*`,
                destination: `/docs/slate/${section}/:page*`,
                permanent: true,
            })),
            // The roadmap page is gone; its address is still linked from outside.
            { source: '/roadmap', destination: '/', permanent: false },
        ]
    },
    async rewrites() {
        return EXPERIMENTS.flatMap(({ path, origin }) => [
            { source: `/${path}`, destination: `${origin}/${path}/` },
            { source: `/${path}/`, destination: `${origin}/${path}/` },
            { source: `/${path}/:rest*`, destination: `${origin}/${path}/:rest*` },
        ])
    },
}

export default nextConfig
