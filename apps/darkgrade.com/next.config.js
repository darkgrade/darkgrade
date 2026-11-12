/** Separate Vercel apps served under darkgrade.com at /<path>/. */
const EXPERIMENTS = [
    { path: 'toolbench', origin: 'https://toolbench-gilt.vercel.app' },
    { path: 'voicebench', origin: 'https://voicebench-six.vercel.app' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
    // The experiments' canonical URLs end in a slash; Next's default slash-stripping redirect would bounce them.
    skipTrailingSlashRedirect: true,
    async rewrites() {
        return EXPERIMENTS.flatMap(({ path, origin }) => [
            { source: `/${path}`, destination: `${origin}/${path}/` },
            { source: `/${path}/`, destination: `${origin}/${path}/` },
            // Keep a trailing slash through the proxy: the experiments redirect to add one.
            { source: `/${path}/:rest*/`, destination: `${origin}/${path}/:rest*/` },
            { source: `/${path}/:rest*`, destination: `${origin}/${path}/:rest*` },
        ])
    },
}

export default nextConfig
