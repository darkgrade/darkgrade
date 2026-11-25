import type { Metadata } from 'next'

import { Privacy } from '@/app/components/privacy/privacy'

export const metadata: Metadata = {
    title: 'Privacy · Darkgrade',
    description: 'Data we collect, why we collect it, which services we use, and the controls you have.',
    alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
    return <Privacy />
}
