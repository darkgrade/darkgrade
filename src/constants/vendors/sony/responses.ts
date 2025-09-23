/**
 * Sony response codes - extending PTP
 */

import { ResponseDefinition } from '@constants/types'
import { PTPResponses } from '@constants/ptp/responses'

/**
 * Sony response codes - extending PTP
 */
export const SonyResponses = {
  ...PTPResponses,
} as const satisfies ResponseDefinition

export type SonyResponseDefinitions = typeof SonyResponses