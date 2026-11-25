import { pendingArea, type SmokeArea } from '@scripts/camera-smoke/smoke-area'

/** Replace with real steps when this area's operations land; see settings.ts for the pattern. */
export const zoomSmoke: SmokeArea = pendingArea('zoom', 'zoomTo, startZoom and stopZoom')
