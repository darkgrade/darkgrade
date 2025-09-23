/**
 * Sony events - extending PTP
 */

import { EventDefinition } from '@constants/types'
import { PTPEvents } from '@constants/ptp/events'

/**
 * Sony events - extending PTP
 */
export const SonyEvents = {
    ...PTPEvents,
} as const satisfies EventDefinition

export type SonyEventDefinitions = typeof SonyEvents