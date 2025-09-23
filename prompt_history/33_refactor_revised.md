We are building an API around Picture Transfer Protocol (PTP).

We have amassed a vast collection on this protocol (both the generic ISO spec and various vendor implementations). You have access to all of this in the `docs/` folder.

Essential background context:

- You **MUST FULLY** read, understand, and adhere to this prompt before continuing.
- You **MUST FULLY** read, understand, and adhere to the important notes before continuing.
- You **MUST FULLY** read, understand, and adhere to the goals before continuing.
- You **MUST FULLY** read, understand, and adhere to the success criteria before continuing.
- You **MUST FULLY** read, understand, and adhere to `./AGENTS.md` before continuing.
- You _may_ read through `prompt_history/` to understand our work so far at any time.
- You _may_ read through anything in the `docs/` folder to understand the ISO or vendor implementations of the spec.

Evaluate the attached refactor proposal against the below goals and highlight any areas we have not achieved a goal.

Goals:

* **Refactor PTP constants into spec-mirrored files** (Operation, Response, Event, Device Property)
* **Implement universal HexCode type** for hex-encoded values across all relevant areas
* **Structure vendor-specific constants** 
  - Place in vendor-specific folders
  - Mirror PTP constants folder structure
* **Add Control specification**
  - Represent button presses and hardware input emulation
  - Define vendor-specific implementation (not in PTP spec)
* **Enhance Property Mapper interface**
  - Extend and generalize for all types
  - Update vendor specifications accordingly
* **Simplify Generic PTP Camera**
  - Mirror PTP spec implementation directly
  - Remove unnecessary overrides
* **Add comprehensive descriptions**
  - Include for PTP implementation and vendor overrides
  - Encode parameters for set/get operations with parameters
* **Remove backwards compatibility requirements**
  - Replace all references with new structure
* **Centralize datatype definitions**
  - Create single file in PTP constants folder
  - Remove from src/core/interfaces/message-builder.interface.ts
* **Eliminate duplicate naming**
  - Use single IN_ALL_UPPER_SNAKE_CASE naming convention
  - Define as object lists with name field
  - Generate runtime mappings as needed
* **Streamline vendor constant mappings**
  - Same names indicate ISO spec overrides
  - Different names indicate ISO spec extensions
  - Remove explicit generic-to-vendor mappings
* **Implement encoder/decoder for device properties**
  - Support on both ISO and vendor sides
  - Decode: raw hex → pretty string (0x00000064 → "ISO 100")
  - Encode: pretty string → raw hex
* **Ensure TypeScript compatibility**
  - Full IntelliSense support
  - Runtime error handling for incorrect parameters
  - Complete referenceability
