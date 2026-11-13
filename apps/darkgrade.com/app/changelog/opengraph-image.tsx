import { CARD_CONTENT_TYPE, CARD_SIZE_PIXELS, drawPageCard } from '@/app/components/page-card'

export const alt = 'Changelog · Darkgrade'
export const size = CARD_SIZE_PIXELS
export const contentType = CARD_CONTENT_TYPE

export default function OpenGraphImage() {
    return drawPageCard({
        main: 'Changelog',
        sub: 'A dated record of what ships in Link and Studio',
        path: '/changelog',
    })
}
