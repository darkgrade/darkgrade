import { pendingArea, type SmokeArea } from '@scripts/camera-smoke/smoke-area'

/** Replace with real steps when this area's operations land; see settings.ts for the pattern. */
export const mediaSmoke: SmokeArea = pendingArea('media', 'getCardStatus, listMedia, getMediaPreview and downloadMedia')
