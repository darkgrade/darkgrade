/**
 * Example usage of the V7 constants architecture
 * Demonstrates type safety, validation, and runtime utilities
 */

import {
  // Import PTP constants
  PTPOperations,
  PTPOperationMapper,
  PTPResponseMapper,
  
  // Import Sony extensions
  Sony,
  SonyPropertyMapper,
  SonyControlMapper,
} from './index'

/**
 * Example 1: Type-safe constant access
 */
function exampleDirectAccess() {
  // Direct access to constants with full IntelliSense
  const openSessionOp = PTPOperations.OPEN_SESSION
  console.log(openSessionOp.code) // 0x1002
  console.log(openSessionOp.description) // "Open a new session with the device"
  console.log(openSessionOp.parameters?.[0].name) // "sessionId"
  
  // Sony-specific property
  const shutterSpeed = Sony.SonyProperties.SHUTTER_SPEED
  console.log(shutterSpeed.code) // 0xD20D
  console.log(shutterSpeed.unit) // "seconds"
  
  // Type safety - TypeScript knows the exact structure
  if (shutterSpeed.encode) {
    const encoded = shutterSpeed.encode('1/250')
    console.log(encoded) // Encoded value
  }
}

/**
 * Example 2: Runtime mapping and lookup
 */
function exampleRuntimeLookup() {
  // Look up operation by code
  const operation = PTPOperationMapper.getByCode(0x1001)
  if (operation) {
    console.log(operation.description) // "Get device information..."
  }
  
  // Look up property by name
  const property = SonyPropertyMapper.getByName('ISO_SENSITIVITY')
  if (property) {
    console.log(property.code) // 0xD21E
  }
  
  // Get human-readable string for debugging
  console.log(PTPResponseMapper.toString(0x2001)) // "OK (0x2001)"
  
  // Check if code is known
  if (PTPOperationMapper.isKnown(0x1009)) {
    console.log('GET_OBJECT operation is supported')
  }
}

/**
 * Example 3: Property encoding and decoding
 */
function examplePropertyEncoding() {
  // Encode a shutter speed value
  const encoded = SonyPropertyMapper.encode(
    Sony.SonyProperties.SHUTTER_SPEED.code,
    '1/250'
  )
  console.log(`Encoded shutter speed: 0x${encoded.toString(16)}`)
  
  // Decode a shutter speed value
  const decoded = SonyPropertyMapper.decode(
    Sony.SonyProperties.SHUTTER_SPEED.code,
    0x00010FA
  )
  console.log(`Decoded shutter speed: ${decoded}`) // "1/250"
  
  // Encode ISO value
  const isoEncoded = SonyPropertyMapper.encode(
    Sony.SonyProperties.ISO_SENSITIVITY.code,
    'AUTO'
  )
  console.log(`Encoded ISO: 0x${isoEncoded.toString(16)}`) // 0x00FFFFFF
  
  // Decode ISO value
  const isoDecoded = SonyPropertyMapper.decode(
    Sony.SonyProperties.ISO_SENSITIVITY.code,
    0x00FFFFFF
  )
  console.log(`Decoded ISO: ${isoDecoded}`) // "ISO AUTO"
}

/**
 * Example 4: Working with controls
 */
function exampleControls() {
  // Get control definition
  const shutterHalfPress = Sony.SonyControls.SHUTTER_HALF_PRESS
  console.log(`Control property: 0x${shutterHalfPress.property.toString(16)}`)
  console.log(`Control value: 0x${shutterHalfPress.value.toString(16)}`)
  console.log(`Holdable: ${shutterHalfPress.holdable}`)
  
  // Look up controls by property code
  const shutterControls = SonyControlMapper.getByProperty(0xD2C1)
  console.log(`Shutter controls: ${shutterControls.length}`)
  
  // Get all unique property codes
  const allPropertyCodes = SonyControlMapper.getAllPropertyCodes()
  console.log(`Total control properties: ${allPropertyCodes.length}`)
}

/**
 * Example 5: Type validation at compile time
 * The satisfies operator ensures our definitions match expected shapes
 */
function exampleTypeValidation() {
  // This would fail at compile time if structure is wrong:
  // const BadProperties = {
  //   INVALID: {
  //     name: 'INVALID',
  //     // Missing required 'code' field!
  //   }
  // } as const satisfies PropertyDefinitionShape
  // ^^^ TypeScript Error: Property 'code' is missing
  
  // But vendor extensions can choose not to validate:
  const CustomVendorOps = {
    CUSTOM_OP: {
      code: 0x9500,
      description: 'Custom vendor operation',
      customField: 'This is allowed without validation'
    }
  } as const // No satisfies clause - flexible structure
  
  console.log(CustomVendorOps.CUSTOM_OP.customField) // OK
}

/**
 * Example 6: Iterating over all constants
 */
function exampleIteration() {
  // Get all operation codes
  const allOpCodes = PTPOperationMapper.getAllCodes()
  console.log(`Total PTP operations: ${allOpCodes.length}`)
  
  // Get all property names
  const allPropNames = SonyPropertyMapper.getAllNames()
  console.log(`Total Sony properties: ${allPropNames.length}`)
  
  // Find all writable properties
  const writableProps = SonyPropertyMapper.getAllCodes()
    .filter(code => SonyPropertyMapper.isWritable(code))
  console.log(`Writable properties: ${writableProps.length}`)
}

/**
 * Example 7: Error handling with unknown codes
 */
function exampleErrorHandling(unknownCode: number) {
  // Safe lookup with fallback
  const response = PTPResponseMapper.getByCode(unknownCode)
  if (response) {
    console.log(`Known response: ${response.description}`)
    if (response.recoverable) {
      console.log('This error is recoverable')
    }
  } else {
    console.log(`Unknown response code: 0x${unknownCode.toString(16)}`)
  }
  
  // Get description with fallback
  const description = PTPResponseMapper.getDescription(unknownCode)
    ?? `Unknown response (0x${unknownCode.toString(16)})`
  console.log(description)
}

// Run examples
if (require.main === module) {
  console.log('=== V7 Constants Architecture Examples ===\n')
  
  console.log('1. Direct Access:')
  exampleDirectAccess()
  
  console.log('\n2. Runtime Lookup:')
  exampleRuntimeLookup()
  
  console.log('\n3. Property Encoding:')
  examplePropertyEncoding()
  
  console.log('\n4. Controls:')
  exampleControls()
  
  console.log('\n5. Type Validation:')
  exampleTypeValidation()
  
  console.log('\n6. Iteration:')
  exampleIteration()
  
  console.log('\n7. Error Handling:')
  exampleErrorHandling(0x9999)
}