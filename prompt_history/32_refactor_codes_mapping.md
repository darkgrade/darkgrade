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

We'd like to overhaul and simplify the constant mapping for vendors to be more ergonomic and easier to maintain.

Our goals at this stage are to generate a proposal for:

- [ ] Refactor our PTP constants into separate files that mirror the PTP spec (for example, `Operation`, `Response`, `Event`, `Device Property`)
- [ ] Universally define a `HexCode` type that represents hex-encoded values instead of raw decimal numbers, use it everywhere relevant
- [ ] Vendor-specific constants should live in the vendor specific folder and mirror the structure of the PTP constants folder
- [ ] Add an additional spec for `Control` – used to represent specific button presses or emulate hardware inputs on the camera (this doesn't exist in the PTP spec, so this will be left up to vendor definition)
- [ ] Extend & generalize our Property Mapper interface to work for any of these types and update the vendors specs
- [ ] Generic PTP Camera at this stage should directly mirror the implementation of the PTP spec with no overrides
- [ ] Allow specifying a description for both the PTP implementation and any vendor specific overrides, as well as encoding the parameters of set operations which have parameters or get operations which include parameters
- [ ] There is absolutely no need to make things backwards compatible, replace any references to the new structure
- [ ] Have a single file place where datatypes are defined within the PTP constants folder. Currently, they are defined src/core/interfaces/message-builder.interface.ts which is wrong.
- [ ] Don't require defining the name of things twice (the key of the object and the name field) for any definitions in the constants folders. One should be sufficient, IN_ALL_UPPER_SNAKE_CASE is preferred. Probably I would define things as a list of objects with the name field and then we can generate any mappings we need at runtime.
- [ ] In each vendor constants, we can eliminate the need of defining a specific mapping of generic to vendor codes/operations by defining the vendor ones as the same name. If it has the same name, it should be inferred that this is an override of the default behavior for that property in the ISO spec. If it's a different name, it should be inferred that this is an extension of the default behavior for that property in the ISO spec.
- [ ] Every device property should be able to have an encoder and a decoder, both on the generic ISO side and the vendor side. Decode should take the raw hex value and return a pretty string (e.g. `0x00000064` -> "ISO 100"), and encode should take the pretty string and return the raw hex value.
- [ ] Everything should be referenceable in TypeScript and support intellisense and throw runtime errors if parameters are incorrect

Example:

```typescript
// just pseudocode, actual syntax might look different
export class SonyCamera {
  // ...

  setDeviceProperty() {
    // handle standardized encoding/decoding/setting, works for any device property
  }

  getDeviceProperty() {
    // handle standardized encoding/decoding/setting, works for any device property
  }
}

// just pseudocode, actual syntax might look different
const camera = new Camera() // auto-detects as Sony

camera.setDeviceProperty(DeviceProperty.ISO("ISO 3200")}) // works, should utilize the decode function for sony here
camera.setDeviceProperty(DeviceProperty.ISO("3200")}) // works, should utilize the decode function for sony here
camera.setDeviceProperty(DeviceProperty.ISO("3200", "asdf")}) // does not work, throws TypeScript and runtime error, wrong number of parameters for this property
camera.setDeviceProperty(DeviceProperty.ISO(False))}) // does not work, throws TypeScript and runtime error, parameter is of the wrong type (should be a string)
camera.setDeviceProperty(DeviceProperty.SHUTTER_SPEED("1/20")}) // works, should utilize the decode function for sony here
camera.setDeviceProperty(DeviceProperty.SHUTTER_SPEED(1/20)}) // does not work, throws TypeScript and runtime error, parameter is of the wrong type (should be a string as a fraction)

camera.getDeviceProperty({DeviceProperty.ISO}) // "ISO 3200"
camera.getDeviceProperty({DeviceProperty.SHUTTER_SPEED}) // "1/20"
```
