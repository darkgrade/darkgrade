import type { Metadata } from 'next'

import { Changelog } from '@/app/components/changelog/changelog'

export const metadata: Metadata = {
    title: 'Changelog · Darkgrade',
    description:
        'A record of what ships in Link and Studio. Coming soon; until then, every change is public on GitHub.',
    alternates: { canonical: '/changelog' },
}

export default function ChangelogPage() {
    return <Changelog />
}
