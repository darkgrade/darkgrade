import type { Metadata } from 'next'

import { Blog } from '@/app/components/blog/blog'

export const metadata: Metadata = {
    title: 'Blog · Darkgrade',
    description:
        'What we are learning about cameras, local models and the cut. Coming soon; until then we write in the open on GitHub and in Discord.',
    alternates: { canonical: '/blog' },
}

export default function BlogPage() {
    return <Blog />
}
