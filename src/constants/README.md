# PTP Constants V7 Architecture

## Overview

This is the V7 implementation of PTP constants with **type-safe validation** using TypeScript's `satisfies` operator. This architecture provides:

- ✅ **Compile-time validation** of constant structures
- ✅ **Full type inference** with literal types
- ✅ **Runtime mapping utilities** for dynamic lookups
- ✅ **Extensible vendor support** without breaking changes
- ✅ **Self-documenting** constants with descriptions
- ✅ **Zero runtime overhead** - all validation at compile time

## Key Features

### 1. Type Validation with `satisfies`

```typescript
export const PTPResponses = {
  OK: {
    name: 'OK',
    code: 0x2001,
    description: 'Operation completed successfully',
    recoverable: true
  }
  // ... more responses
} as const satisfies ResponseDefinitionShape
```

The `satisfies` operator ensures our definitions match expected shapes while preserving literal types.

### 2. Property System with Encoding/Decoding

```typescript
// Properties can have custom encoders/decoders
SHUTTER_SPEED: {
  code: 0xD20D,
  encode: (value: string) => {
    if (value === 'BULB') return 0x00000000
    // ... encoding logic
  },
  decode: (value: number) => {
    if (value === 0x00000000) return 'BULB'
    // ... decoding logic
  }
}
```

### 3. Runtime Mappers

```typescript
// Look up by code
const operation = PTPOperationMapper.getByCode(0x1001)

// Look up by name  
const property = SonyPropertyMapper.getByName('ISO_SENSITIVITY')

// Encode/decode values
const encoded = SonyPropertyMapper.encode(0xD20D, '1/250')
const decoded = SonyPropertyMapper.decode(0xD20D, encoded)
```

## Directory Structure

```
src/constants/
├── types.ts                 # Core type definitions
├── validation-types.ts      # Validation shapes for satisfies
├── property-types.ts        # Property system types
├── utilities.ts             # Runtime mapping utilities
├── ptp/                     # PTP standard constants
│   ├── operations.ts        # PTP operations with validation
│   ├── responses.ts         # PTP response codes  
│   ├── events.ts           # PTP events
│   ├── properties.ts       # PTP device properties
│   ├── formats.ts          # Object formats
│   ├── storage.ts          # Storage types
│   └── index.ts            # PTP exports and mappers
├── vendors/                 # Vendor extensions
│   └── sony/
│       ├── properties.ts   # Sony properties (extends PTP)
│       ├── operations.ts   # Sony operations
│       ├── events.ts       # Sony events
│       ├── responses.ts    # Sony response codes
│       ├── controls.ts     # Hardware controls
│       ├── constants.ts    # Sony-specific constants
│       └── index.ts        # Sony exports and mappers
└── index.ts                # Main entry point

```

## Usage Examples

### Direct Access
```typescript
import { PTPOperations, Sony } from './constants'

// PTP standard operation
const op = PTPOperations.OPEN_SESSION
console.log(op.code)        // 0x1002
console.log(op.description) // "Open a new session..."

// Sony-specific property
const iso = Sony.SonyProperties.ISO_SENSITIVITY
console.log(iso.code) // 0xD21E
```

### Runtime Lookup
```typescript
import { PTPResponseMapper } from './constants'

// Look up response by code
const response = PTPResponseMapper.getByCode(0x2001)
if (response?.recoverable) {
  // Handle recoverable error
}

// Get human-readable string
console.log(PTPResponseMapper.toString(0x2001))
// Output: "OK (0x2001)"
```

### Property Encoding
```typescript
import { SonyPropertyMapper } from './constants'

// Encode shutter speed
const encoded = SonyPropertyMapper.encode(
  0xD20D, // SHUTTER_SPEED code
  '1/250'
)

// Decode back
const decoded = SonyPropertyMapper.decode(0xD20D, encoded)
console.log(decoded) // "1/250"
```

### Hardware Controls
```typescript
import { Sony, SonyControlMapper } from './constants'

// Direct access
const control = Sony.SonyControls.SHUTTER_HALF_PRESS
console.log(control.property) // 0xD2C1
console.log(control.value)    // 0x0002
console.log(control.holdable)  // true

// Find all controls for a property
const shutterControls = SonyControlMapper.getByProperty(0xD2C1)
```

## Type Safety Benefits

### Compile-Time Validation

```typescript
// ❌ This would fail at compile time:
const BadProperties = {
  INVALID: {
    name: 'INVALID',
    // Missing required 'code' field!
  }
} as const satisfies PropertyDefinitionShape
// TypeScript Error: Property 'code' is missing
```

### Type Inference

```typescript
// TypeScript knows exact structure and values
const op = PTPOperations.GET_DEVICE_INFO
//    ^? const op: {
//         readonly code: 0x1001
//         readonly description: "Get device information..."
//       }
```

### Vendor Flexibility

Vendor extensions can choose whether to validate:

```typescript
// With validation (recommended for shared code)
export const VendorOps = {
  // ...
} as const satisfies OperationDefinitionShape

// Without validation (more flexible)
export const VendorOps = {
  CUSTOM_OP: {
    code: 0x9500,
    customField: 'Allowed without validation'
  }
} as const
```

## Implementation Details

### Validation Types
- `ResponseDefinitionShape` - Response code structure
- `OperationDefinitionShape` - Operation structure  
- `EventDefinitionShape` - Event structure
- `PropertyDefinitionShape` - Property structure
- `FormatDefinitionShape` - Format structure
- `StorageTypeDefinitionShape` - Storage type structure
- `ControlDefinitionShape` - Control structure

### Mapper Classes
- `ConstantMapper<T>` - Generic mapper for constants with `code` field
- `PropertyMapper<T>` - Specialized mapper for properties with encode/decode
- `ControlMapper<T>` - Specialized mapper for hardware controls

### Property Types
- `NumericProperty` - Simple numeric properties
- `StringProperty` - String properties
- `EnumProperty` - Properties with enumerated values
- `CustomProperty` - Properties with custom encode/decode functions

## Migration from Existing Code

The V7 architecture preserves all existing hex codes and functionality. To migrate:

1. Constants are now objects with metadata instead of simple values
2. Use mappers for runtime lookups instead of reverse maps
3. Properties have built-in encode/decode support
4. Type validation happens at compile time

## Best Practices

1. **Always validate PTP standard constants** with `satisfies`
2. **Vendor extensions** can skip validation for flexibility
3. **Use mappers** for runtime lookups, not direct object access
4. **Include descriptions** for all constants for documentation
5. **Test encoding/decoding** for custom properties

## Performance

- **Zero runtime cost** for validation (compile-time only)
- **Efficient mappers** using Maps for O(1) lookups
- **Literal types** enable compiler optimizations
- **Tree-shaking friendly** - unused constants are eliminated

## Future Enhancements

Potential improvements for V8:
- Async property loading for large constant sets
- Plugin system for vendor extensions
- Code generation from PTP specification XML
- Automatic reverse mapping generation
- Property validation with schemas