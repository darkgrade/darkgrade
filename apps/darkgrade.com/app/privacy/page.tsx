import type { Metadata } from 'next'

import { Privacy } from '@/app/components/privacy/privacy'

export const metadata: Metadata = {
    title: 'Privacy · Darkgrade',
    description:
        'Darkgrade’s privacy policy is being written and will be published here. Questions: hello@darkgrade.com.',
    alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
    return <Privacy />
}
