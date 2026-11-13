import { CARD_CONTENT_TYPE, CARD_SIZE_PIXELS, drawPageCard } from '@/app/components/page-card'

export const alt = 'Privacy · Darkgrade'
export const size = CARD_SIZE_PIXELS
export const contentType = CARD_CONTENT_TYPE

export default function OpenGraphImage() {
    return drawPageCard({
        main: 'Privacy',
        sub: 'How we handle your data',
        path: '/privacy',
    })
}
