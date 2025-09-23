/**
 * Runtime mapping utilities for constants
 * V7 Architecture - Type-safe with validation
 */

import type { HexCode } from './types'

/**
 * Generic mapping utilities for all constant types
 */
export class ConstantMapper<T extends Record<string, { code: HexCode, [key: string]: any }>> {
  private codeToItem: Map<HexCode, T[keyof T]>
  private nameToItem: Map<string, T[keyof T]>
  
  constructor(private constants: T) {
    this.codeToItem = new Map()
    this.nameToItem = new Map()
    
    for (const [key, value] of Object.entries(constants)) {
      this.codeToItem.set(value.code, value as T[keyof T])
      this.nameToItem.set(key, value as T[keyof T])
    }
  }
  
  /**
   * Get constant by hex code
   */
  getByCode(code: HexCode): T[keyof T] | undefined {
    return this.codeToItem.get(code)
  }
  
  /**
   * Get constant by name
   */
  getByName(name: keyof T): T[keyof T] | undefined {
    return this.nameToItem.get(name as string)
  }
  
  /**
   * Get human-readable string for a code
   */
  toString(code: HexCode): string {
    const item = this.getByCode(code)
    if (item && 'name' in item) {
      return `${item.name} (0x${code.toString(16).padStart(4, '0')})`
    }
    return `Unknown (0x${code.toString(16).padStart(4, '0')})`
  }
  
  /**
   * Get description for a code
   */
  getDescription(code: HexCode): string | undefined {
    const item = this.getByCode(code)
    if (item && 'description' in item) {
      return item.description as string
    }
    return undefined
  }
  
  /**
   * Check if code is known
   */
  isKnown(code: HexCode): boolean {
    return this.codeToItem.has(code)
  }
  
  /**
   * Get all codes
   */
  getAllCodes(): HexCode[] {
    return Array.from(this.codeToItem.keys())
  }
  
  /**
   * Get all names
   */
  getAllNames(): (keyof T)[] {
    return Object.keys(this.constants) as (keyof T)[]
  }
  
  /**
   * Get the raw constants object
   */
  getConstants(): T {
    return this.constants
  }
}

// Property mapper with special handling for encoding/decoding
import type { Property } from './property-types'

export class PropertyMapper<T extends Record<string, Property>> {
  private codeToProperty: Map<HexCode, Property>
  private nameToProperty: Map<string, Property>
  
  constructor(private properties: T) {
    this.codeToProperty = new Map()
    this.nameToProperty = new Map()
    
    for (const [key, value] of Object.entries(properties)) {
      this.codeToProperty.set(value.code, value)
      this.nameToProperty.set(key, value)
    }
  }
  
  /**
   * Get property by code
   */
  getByCode(code: HexCode): Property | undefined {
    return this.codeToProperty.get(code)
  }
  
  /**
   * Get property by name
   */
  getByName(name: keyof T): Property | undefined {
    return this.nameToProperty.get(name as string)
  }
  
  /**
   * Get human-readable string for a property code
   */
  toString(code: HexCode): string {
    const prop = this.getByCode(code)
    if (prop) {
      const unit = prop.unit ? ` (${prop.unit})` : ''
      return `${prop.name}${unit} [0x${code.toString(16).padStart(4, '0')}]: ${prop.description}`
    }
    return `Unknown Property (0x${code.toString(16).padStart(4, '0')})`
  }
  
  /**
   * Encode a value for a property
   */
  encode(code: HexCode, value: any): HexCode | Uint8Array {
    const prop = this.getByCode(code)
    if (!prop) {
      throw new Error(`Unknown property code: 0x${code.toString(16)}`)
    }
    
    // Check if property has custom encoder
    if ('encode' in prop && typeof prop.encode === 'function') {
      return prop.encode(value)
    }
    
    // Check if property has enum values
    if ('enum' in prop && prop.enum) {
      const enumValue = prop.enum[value as keyof typeof prop.enum]
      if (enumValue !== undefined) {
        return enumValue
      }
    }
    
    // Return value as-is for basic properties
    return value
  }
  
  /**
   * Decode a value from a property
   */
  decode(code: HexCode, value: HexCode | Uint8Array): any {
    const prop = this.getByCode(code)
    if (!prop) {
      return value
    }
    
    // Check if property has custom decoder
    if ('decode' in prop && typeof prop.decode === 'function') {
      return prop.decode(value)
    }
    
    // Check if property has enum values (reverse lookup)
    if ('enum' in prop && prop.enum && typeof value === 'number') {
      for (const [key, enumValue] of Object.entries(prop.enum)) {
        if (enumValue === value) {
          return key
        }
      }
    }
    
    // Return value as-is for basic properties
    return value
  }
  
  /**
   * Check if property is writable
   */
  isWritable(code: HexCode): boolean {
    const prop = this.getByCode(code)
    return prop ? (prop.writable ?? false) : false
  }
  
  /**
   * Get all property codes
   */
  getAllCodes(): HexCode[] {
    return Array.from(this.codeToProperty.keys())
  }
  
  /**
   * Get all property names
   */
  getAllNames(): (keyof T)[] {
    return Object.keys(this.properties) as (keyof T)[]
  }
  
  /**
   * Get the raw properties object
   */
  getProperties(): T {
    return this.properties
  }
}

/**
 * Control mapper for hardware control constants
 */
export class ControlMapper<T extends Record<string, { property: HexCode, value: HexCode, [key: string]: any }>> {
  private controls: Array<T[keyof T]>
  private nameToControl: Map<string, T[keyof T]>
  
  constructor(private controlsObj: T) {
    this.controls = Object.values(controlsObj) as Array<T[keyof T]>
    this.nameToControl = new Map()
    
    for (const [key, value] of Object.entries(controlsObj)) {
      this.nameToControl.set(key, value as T[keyof T])
    }
  }
  
  /**
   * Get control by name
   */
  getByName(name: keyof T): T[keyof T] | undefined {
    return this.nameToControl.get(name as string)
  }
  
  /**
   * Find controls by property code
   */
  getByProperty(propertyCode: HexCode): Array<T[keyof T]> {
    return this.controls.filter(control => control.property === propertyCode)
  }
  
  /**
   * Find control by property and value
   */
  getByPropertyAndValue(propertyCode: HexCode, value: HexCode): T[keyof T] | undefined {
    return this.controls.find(control => 
      control.property === propertyCode && control.value === value
    )
  }
  
  /**
   * Get all control names
   */
  getAllNames(): (keyof T)[] {
    return Object.keys(this.controlsObj) as (keyof T)[]
  }
  
  /**
   * Get all unique property codes used by controls
   */
  getAllPropertyCodes(): HexCode[] {
    const codes = new Set<HexCode>()
    this.controls.forEach(control => codes.add(control.property))
    return Array.from(codes)
  }
  
  /**
   * Get the raw controls object
   */
  getControls(): T {
    return this.controlsObj
  }
}