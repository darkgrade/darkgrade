/**
 * PTP Events with type validation
 */

import { EventDefinition } from '@constants/types'

/**
 * PTP Events with type validation
 */
export const PTPEvents = {

} as const satisfies EventDefinition

export type PTPEventDefinitions = typeof PTPEvents