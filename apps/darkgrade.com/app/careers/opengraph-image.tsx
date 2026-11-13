import { CARD_CONTENT_TYPE, CARD_SIZE_PIXELS, drawPageCard } from '@/app/components/page-card'

export const alt = 'Careers · Darkgrade'
export const size = CARD_SIZE_PIXELS
export const contentType = CARD_CONTENT_TYPE

export default function OpenGraphImage() {
    return drawPageCard({
        main: 'Careers',
        sub: 'No open roles right now, but we like hearing from people who build',
        path: '/careers',
    })
}
