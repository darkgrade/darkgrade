/**
 * PTP Storage Types with type validation
 */

import { StorageDefinition } from '@constants/types'

/**
 * PTP Storage Types with type validation
 */
export const PTPStorageTypes = {
  UNDEFINED: {
    name: 'UNDEFINED',
    code: 0x0000,
    description: 'Undefined storage type'
  },
  FIXED_ROM: {
    name: 'FIXED_ROM',
    code: 0x0001,
    description: 'Fixed read-only memory (built-in non-writable memory)'
  },
  REMOVABLE_ROM: {
    name: 'REMOVABLE_ROM',
    code: 0x0002,
    description: 'Removable read-only memory (CD, DVD)'
  },
  FIXED_RAM: {
    name: 'FIXED_RAM',
    code: 0x0003,
    description: 'Fixed RAM storage (internal writable memory)'
  },
  REMOVABLE_RAM: {
    name: 'REMOVABLE_RAM',
    code: 0x0004,
    description: 'Removable RAM storage (memory card, SD card)'
  }
} as const satisfies StorageDefinition

export type PTPStorageTypeDefinitions = typeof PTPStorageTypes

/**
 * PTP Storage File System Types
 */
export const PTPFilesystemTypes = {
  UNDEFINED: 0x0000,
  GENERIC_FLAT: 0x0001,
  GENERIC_HIERARCHICAL: 0x0002,
  DCF: 0x0003,
} as const

export type PTPFilesystemType = typeof PTPFilesystemTypes[keyof typeof PTPFilesystemTypes]

/**
 * PTP Storage Access Capability
 */
export const PTPStorageAccess = {
  READ_WRITE: 0x0000,
  READ_ONLY_WITHOUT_OBJECT_DELETION: 0x0001,
  READ_ONLY_WITH_OBJECT_DELETION: 0x0002,
} as const

export type PTPStorageAccessType = typeof PTPStorageAccess[keyof typeof PTPStorageAccess]