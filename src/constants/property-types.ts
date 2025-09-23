/**
 * Property type system with validation
 * V7 Architecture - Type-safe with validation
 */

import type { HexCode, DataType, PropertyForm } from './types'

/**
 * Property descriptor for allowed values
 */
export interface PropertyDescriptor<T> {
  current?: T
  default?: T
  form: PropertyForm
  min?: T
  max?: T
  step?: T
  allowedValues?: T[]
}

/**
 * Base property definition
 */
export interface BaseProperty<TName extends string = string, TValue = any> {
  name: TName
  code: HexCode
  type: DataType
  unit?: string
  description: string
  writable?: boolean
  descriptor?: PropertyDescriptor<TValue>
}

/**
 * Property with enum values
 */
export interface EnumProperty<TName extends string = string, TEnum extends string = string> 
  extends BaseProperty<TName, TEnum> {
  enum: Record<TEnum, HexCode>
}

/**
 * Property with custom encoding
 */
export interface CustomProperty<TName extends string = string, TInput = any, TOutput = TInput> 
  extends BaseProperty<TName, TInput> {
  encode: (value: TInput) => HexCode | Uint8Array
  decode: (value: HexCode | Uint8Array) => TOutput
}

/**
 * Numeric property
 */
export interface NumericProperty<TName extends string = string> 
  extends BaseProperty<TName, number> {}

/**
 * String property
 */
export interface StringProperty<TName extends string = string> 
  extends BaseProperty<TName, string> {}

/**
 * Union of all property types
 */
export type Property = 
  | EnumProperty
  | CustomProperty
  | NumericProperty
  | StringProperty

/**
 * Property definition shape for validation
 */
export type PropertyDefinitionShape = Record<string, Property>