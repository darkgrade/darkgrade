/** @type {import('next').NextConfig} */
const nextConfig = {
    // /toolbench/ and /voicebench/ are rewritten to their own apps (vercel.json) whose canonical URLs
    // end in a slash; Next's default slash-stripping redirect would bounce them.
    skipTrailingSlashRedirect: true,
}

export default nextConfig
