import { LOOPBACK_HOSTNAMES } from '@/app/components/dev-font-chooser/dev-fonts'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

/* A local tool, not a page of the site: it exists only under `next dev`, and
   only when reached through a loopback host. Anywhere else this route is a 404,
   and it is never prerendered or indexed. */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
    title: 'Social heroes · Darkgrade (dev)',
    robots: { index: false, follow: false },
}

function hostnameOf(hostHeader: string): string {
    // "[::1]:3000" -> "[::1]", "localhost:3000" -> "localhost"
    return hostHeader.replace(/:\d+$/, '')
}

export default async function SocialPage() {
    // The studio is imported INSIDE this branch on purpose. The bundler resolves
    // NODE_ENV at build time, so in a production build the branch (and the
    // import) is removed outright: no studio code is emitted for anyone to fetch.
    if (process.env.NODE_ENV === 'development') {
        const hostHeader = (await headers()).get('host') ?? ''
        if (LOOPBACK_HOSTNAMES.includes(hostnameOf(hostHeader))) {
            const { SocialStudio } = await import('@/app/social/social-studio')
            return <SocialStudio />
        }
    }
    notFound()
}
