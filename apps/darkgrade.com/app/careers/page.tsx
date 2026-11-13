import type { Metadata } from 'next'

import { Careers } from '@/app/components/careers/careers'

export const metadata: Metadata = {
    title: 'Careers · Darkgrade',
    description:
        'There are no open roles at Darkgrade right now. If you want to build with us, write to careers@darkgrade.com.',
    alternates: { canonical: '/careers' },
}

export default function CareersPage() {
    return <Careers />
}
