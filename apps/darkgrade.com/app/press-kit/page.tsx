import type { Metadata } from 'next'

import { PressKit } from '@/app/press-kit/press-kit'

export const metadata: Metadata = {
    title: 'Press kit · Darkgrade',
    description:
        'Darkgrade logos and images, drawn by the site itself at the size each platform asks for. Take one, or the whole set as a zip.',
    alternates: { canonical: '/press-kit' },
}

export default function PressKitPage() {
    return <PressKit />
}
