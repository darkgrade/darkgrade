import type { Metadata } from 'next'

import { Changelog } from '@/app/components/changelog/changelog'

export const metadata: Metadata = {
    title: 'Changelog · Darkgrade',
    description:
        'A record of what ships in Slate and Studio. Coming soon; until then, changes are public on GitHub as they merge.',
    alternates: { canonical: '/changelog' },
}

export default function ChangelogPage() {
    return <Changelog />
}
