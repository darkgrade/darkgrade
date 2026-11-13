import { CARD_CONTENT_TYPE, CARD_SIZE_PIXELS, drawPageCard } from '@/app/components/page-card'

export const alt = 'About · Darkgrade'
export const size = CARD_SIZE_PIXELS
export const contentType = CARD_CONTENT_TYPE

export default function OpenGraphImage() {
    return drawPageCard({
        main: 'About',
        sub: 'A small team in Denver, Colorado, building local-first AI for creative pros',
        path: '/about',
    })
}
