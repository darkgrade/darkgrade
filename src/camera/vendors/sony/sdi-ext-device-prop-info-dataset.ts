import { createDataView, sliceBuffer, decodePTPValue, getPTPValueSize } from '@core/buffers'
import { DataTypeValue, HexCode } from '@constants/types'
import { SonyProperties } from '@constants/vendors/sony/properties'

/**
 * SDIExtDevicePropInfo Dataset
 *
 * | Field                 | Field Order | Size (Bytes) | Datatype |
 * | --------------------- | ----------- | ------------ | -------- |
 * | Device Property Code  | 1           | 2            | UINT16   |
 * | DataType              | 2           | 2            | UINT16   |
 * | GetSet                | 3           | 1            | UINT8    |
 * | IsEnabled             | 4           | 1            | UINT8    |
 * | Factory Default Value | 5           | Variable     | Any      |
 * | Current Value         | 6           | Variable     | Any      |
 * | Form Flag             | 7           | 1            | UINT8    |
 *
 * The GetSet field is defined as the following:
 *
 * -   0x00: The Initiator cannot set the value
 * -   0x01: The Initiator can set the value
 *
 * The IsEnabled field is defined as the following (for the Initiator UI):
 *
 * -   0x00: False (means invalid, greyed-out, no indication for the button, combo box, some values like shutter speed, F-number)
 * -   0x01: True (means valid, indication for the button, combo box, some values like shutter speed, Fnumber)
 * -   0x02: DispOnly (means only indication; cannot change the value)
 *
 * If IsEnabled is "False", the Factory Default Value and Current Value are not guaranteed.
 *
 * If Form Flag is 0x02 (Enumeration), the Dataset will be the following example:
 *
 * | Field                                                     | Field Order | Size (Bytes)        | Datatype |
 * | --------------------------------------------------------- | ----------- | ------------------- | -------- |
 * | Device Property Code                                      | 1           | 2                   | UINT16   |
 * | DataType                                                  | 2           | 2                   | UINT16   |
 * | GetSet                                                    | 3           | 1                   | UINT8    |
 * | IsEnabled                                                 | 4           | 1                   | UINT8    |
 * | Factory Default Value                                     | 5           | Variable            | Any      |
 * | Current Value                                             | 6           | Variable            | Any      |
 * | Form Flag                                                 | 7           | 1                   | UINT8    |
 * | Num of Enum lists (Set)                                   | 8           | 2                   | UINT16   |
 * | Enum value (Set)[0]                                       | 9           | Depends on DataType | -        |
 * | …                                                         | …           | Depends on DataType | -        |
 * | Enum value (Set)<br>[Num of Enum lists (Set) - 1]         | N           | Depends on DataType | -        |
 * | Num of Enum lists(Get/Set)                                | N+1         | 2                   | UINT16   |
 * | Enum value (Get/Set)[0]                                   | N+2         | Depends on DataType | -        |
 * | …                                                         | …           | Depends on DataType | -        |
 * | Enum value (Get/Set)<br>[Num of Enum lists (Get/Set) - 1] | O           | Depends on DataType | -        |
 */

export type SDIExtDevicePropInfo = {
    devicePropertyCode: HexCode // DataType.UINT16
    dataType: HexCode // DataType.UINT16
    getSet: HexCode // DataType.UINT8
    isEnabled: HexCode // DataType.UINT8
    factoryDefaultValue: any // Any
    currentValue: any // Any
    formFlag: HexCode // DataType.UINT8
}

export type SDIExtDevicePropInfoParsed = {
    devicePropertyCode: HexCode
    devicePropertyName: string
    devicePropertyDescription: string
    dataType: DataTypeValue
    writable: boolean
    enabled: boolean
    factoryDefaultValue: any
    currentValueRaw: any
    currentValueBytes: Uint8Array
    currentValueDecoded: any
    formFlag: HexCode
    enumValuesSet: any[]
    enumValuesGetSet: any[]
}

export const parseSDIExtDevicePropInfo = (data: Uint8Array): SDIExtDevicePropInfoParsed => {
    const view = createDataView(data)
    let offset = 0

    // 1. Device Property Code (UINT16)
    const devicePropertyCode = view.getUint16(offset, true)
    offset += 2

    // 2. DataType (UINT16)
    const dataType = view.getUint16(offset, true) as DataTypeValue
    offset += 2

    // 3. GetSet (UINT8)
    const getSet = view.getUint8(offset)
    offset += 1

    // 4. IsEnabled (UINT8)
    const isEnabled = view.getUint8(offset)
    offset += 1

    // 5. Factory Default Value (Variable based on dataType)
    const factoryDefaultValue = decodePTPValue(sliceBuffer(data, offset), dataType)
    const factoryDefaultSize = getPTPValueSize(dataType, sliceBuffer(data, offset))
    offset += factoryDefaultSize

    // 6. Current Value (Variable based on dataType)
    const currentValueBytes = sliceBuffer(data, offset)
    const currentValueRaw = decodePTPValue(currentValueBytes, dataType)
    const currentValueSize = getPTPValueSize(dataType, currentValueBytes)
    offset += currentValueSize

    // 7. Form Flag (UINT8)
    const formFlag = view.getUint8(offset)
    offset += 1

    // Initialize enum arrays
    let enumValuesSet: any[] = []
    let enumValuesGetSet: any[] = []

    // If Form Flag is 0x02 (Enumeration), parse enum lists
    if (formFlag === 0x02) {
        // 8. Num of Enum lists (Set) - UINT16
        const numEnumSet = view.getUint16(offset, true)
        offset += 2

        // 9. Parse Set enum values
        for (let i = 0; i < numEnumSet; i++) {
            const value = decodePTPValue(sliceBuffer(data, offset), dataType)
            enumValuesSet.push(value)
            const valueSize = getPTPValueSize(dataType, sliceBuffer(data, offset))
            offset += valueSize
        }

        // N+1. Num of Enum lists (Get/Set) - UINT16
        const numEnumGetSet = view.getUint16(offset, true)
        offset += 2

        // N+2. Parse Get/Set enum values
        for (let i = 0; i < numEnumGetSet; i++) {
            const value = decodePTPValue(sliceBuffer(data, offset), dataType)
            enumValuesGetSet.push(value)
            const valueSize = getPTPValueSize(dataType, sliceBuffer(data, offset))
            offset += valueSize
        }
    }

    // Look up property info from SonyProperties
    const propertyInfo = Object.values(SonyProperties).find(p => p.code === devicePropertyCode)
    const devicePropertyName = propertyInfo?.name || `Unknown_0x${devicePropertyCode.toString(16).padStart(4, '0')}`
    const devicePropertyDescription = propertyInfo?.description || ''

    return {
        devicePropertyCode,
        devicePropertyName,
        devicePropertyDescription,
        dataType,
        writable: getSet === 0x01,
        enabled: isEnabled === 0x01 || isEnabled === 0x02,
        factoryDefaultValue,
        currentValueRaw,
        currentValueBytes: currentValueBytes.slice(0, currentValueSize),
        // TODO
        currentValueDecoded: currentValueRaw,
        formFlag,
        enumValuesSet,
        enumValuesGetSet,
    }
}

/** SDIDevicePropInfo Dataset Array
 *
 * | Field                                          | Field Order | Size (Bytes) | Datatype |
 * | ---------------------------------------------- | ----------- | ------------ | -------- |
 * | Num of Elements                                | 1           | 8            | UINT64   |
 * | SDIDevicePropInfo Dataset[0]                   | 2           | variable     | UINT16   |
 * | …                                              | …           | variable     | UINT8    |
 * | SDIDevicePropInfo Dataset[Num of Elements - 1] | N           | variable     | UINT8    |
 *
 * Note:
 * Flag of get only difference data:
 * 0x00000000: Gets all data
 * 0x00000001: Gets only difference data
 * Flag of Device Property Option:
 * 0x00000001: Enables extended SDIO Device Property / SDIControlCode
 *
 * The extended SDIO Device Property / SDIControlCode can be used if the camera supports
 * SDIO_GetVendorCodeVersion and the Vendor code version is 3.10 or higher.
 * Please set this flag to utilize all commands supported by the camera. The extended SDIO Device Property
 * uses 0xE000 ~ 0xEFFF, and the SDIControlCode uses 0xF000 ~ 0xFFFF.
 */

export type SDIDevicePropInfo = {
    numOfElements: HexCode // DataType.UINT64
    sdiDevicePropInfoDataset: SDIExtDevicePropInfo[]
}

export type SDIDevicePropInfoParsed = {
    numOfElements: HexCode
    sdiDevicePropInfoDataset: SDIExtDevicePropInfoParsed[]
}

export const parseSDIDevicePropInfoArray = (data: Uint8Array): SDIDevicePropInfoParsed => {
    const view = createDataView(data)
    let offset = 0

    // 1. Num of Elements (UINT64)
    // Read as two UINT32 values in little-endian order (low dword first)
    const lowDword = view.getUint32(offset, true)
    const highDword = view.getUint32(offset + 4, true)
    // For most practical cases, the high dword will be 0
    const numOfElements = lowDword + highDword * 0x100000000
    offset += 8

    // 2. Parse each SDIExtDevicePropInfo dataset
    const sdiDevicePropInfoDataset: SDIExtDevicePropInfoParsed[] = []

    for (let i = 0; i < numOfElements; i++) {
        // Calculate the size of the current SDIExtDevicePropInfo structure
        const structSize = calculateSDIExtDevicePropInfoSize(sliceBuffer(data, offset))

        // Parse the current SDIExtDevicePropInfo
        const propInfo = parseSDIExtDevicePropInfo(sliceBuffer(data, offset, offset + structSize))
        sdiDevicePropInfoDataset.push(propInfo)

        // Move to the next structure
        offset += structSize
    }

    return {
        numOfElements,
        sdiDevicePropInfoDataset,
    }
}

// Helper function to calculate the total size of an SDIExtDevicePropInfo structure in bytes
function calculateSDIExtDevicePropInfoSize(data: Uint8Array): number {
    const view = createDataView(data)
    let offset = 0

    // Skip Device Property Code (UINT16)
    offset += 2

    // Get DataType (UINT16) - needed to calculate value sizes
    const dataType = view.getUint16(offset, true) as DataTypeValue
    offset += 2

    // Skip GetSet (UINT8)
    offset += 1

    // Skip IsEnabled (UINT8)
    offset += 1

    // Skip Factory Default Value (Variable)
    const factoryDefaultSize = getPTPValueSize(dataType, sliceBuffer(data, offset))
    offset += factoryDefaultSize

    // Skip Current Value (Variable)
    const currentValueSize = getPTPValueSize(dataType, sliceBuffer(data, offset))
    offset += currentValueSize

    // Get Form Flag (UINT8)
    const formFlag = view.getUint8(offset)
    offset += 1

    // If Form Flag is 0x02 (Enumeration), skip enum lists
    if (formFlag === 0x02) {
        // Num of Enum lists (Set) - UINT16
        const numEnumSet = view.getUint16(offset, true)
        offset += 2

        // Skip Set enum values
        for (let i = 0; i < numEnumSet; i++) {
            const valueSize = getPTPValueSize(dataType, sliceBuffer(data, offset))
            offset += valueSize
        }

        // Num of Enum lists (Get/Set) - UINT16
        const numEnumGetSet = view.getUint16(offset, true)
        offset += 2

        // Skip Get/Set enum values
        for (let i = 0; i < numEnumGetSet; i++) {
            const valueSize = getPTPValueSize(dataType, sliceBuffer(data, offset))
            offset += valueSize
        }
    }

    return offset
}
