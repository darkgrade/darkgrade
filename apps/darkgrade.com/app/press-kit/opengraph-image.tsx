import { CARD_CONTENT_TYPE, CARD_SIZE_PIXELS, drawPageCard } from '@/app/components/page-card'

export const alt = 'Press kit · Darkgrade'
export const size = CARD_SIZE_PIXELS
export const contentType = CARD_CONTENT_TYPE

export default function OpenGraphImage() {
    return drawPageCard({
        main: 'Press kit',
        sub: 'Logos and images, drawn by the site at the size each platform asks for',
        path: '/press-kit',
    })
}
