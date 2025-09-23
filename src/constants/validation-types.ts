/**
 * Validation type definitions for compile-time shape validation
 * V7 Architecture - Type-safe with validation
 */

import type { HexCode, DataType } from '@constants/types'

/**
 * Response definition shape for validation
 */
export type ResponseDefinitionShape = Record<string, {
  name: string
  code: HexCode
  description: string
  recoverable?: boolean
}>

/**
 * Operation definition shape for validation
 */
export type OperationDefinitionShape = Record<string, {
  code: HexCode
  description: string
  parameters?: Array<{
    name: string
    type: DataType
    description: string
  }>
  hasDataPhase?: boolean
  dataDescription?: string
}>

/**
 * Event definition shape for validation
 */
export type EventDefinitionShape = Record<string, {
  code: HexCode
  description: string
  parameters?: Array<{
    name: string
    type: DataType
    description: string
  }>
}>

/**
 * Format definition shape for validation
 */
export type FormatDefinitionShape = Record<string, {
  name: string
  code: HexCode
  description: string
  fileExtension?: string
  mimeType?: string
}>

/**
 * Storage type definition shape for validation
 */
export type StorageTypeDefinitionShape = Record<string, {
  name: string
  code: HexCode
  description: string
}>

/**
 * Control definition shape for validation
 */
export type ControlDefinitionShape = Record<string, {
  property: HexCode
  value: HexCode
  description: string
  holdable?: boolean
}>