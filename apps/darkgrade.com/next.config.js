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
    // Link's docs moved under /docs/link/ when Studio's docs arrived; old addresses are still indexed.
    async redirects() {
        return ['getting_started', 'ptp-reference'].map((section) => ({
            source: `/docs/${section}/:page*`,
            destination: `/docs/link/${section}/:page*`,
            permanent: true,
        }))
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
