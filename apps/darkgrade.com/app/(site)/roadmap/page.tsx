import type { Metadata } from 'next'
import { Roadmap } from '@/app/components/roadmap'

const TITLE = 'Roadmap — Darkgrade'
const DESCRIPTION = 'What Darkgrade ships today, and everything on the way: from camera control to skipping the edit.'
const OG_IMAGE = 'https://darkgrade.com/darkgrade_opengraph_dark.png'

export const metadata: Metadata = {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: '/roadmap' },
    // metadata merges shallowly: these restate the layout's image and card, or they'd be dropped
    openGraph: {
        title: TITLE,
        description: DESCRIPTION,
        siteName: 'Darkgrade',
        type: 'website',
        url: 'https://darkgrade.com/roadmap',
        images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: 'Darkgrade' }],
    },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
}

/** The roadmap on its own page. The backdrop, header and footer come from the (site) layout. */
export default function RoadmapPage() {
    return <Roadmap />
}
