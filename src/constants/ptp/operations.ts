/**
 * PTP Operations with type validation
 */

import { DataType, OperationDefinition } from '@constants/types'

/**
 * PTP Operations with type validation
 */
export const PTPOperations = {
    OPEN_SESSION: {
        code: 0x1002,
        description:
            'Causes device to allocate resources, assigns handles to data objects if necessary, and performs any connection-specific initialization. The SessionID will then be used by all other operations during the session. Unless otherwise specified, an open session is required to invoke an operation. If the first parameter is 0x00000000, the operation should fail with a response of Invalid_Parameter. If a session is already open, and the device does not support multiple sessions, the response Session_ Already_Open should be returned, with the SessionID of the already open session as the first response parameter. The response Session_Already_Open should also be used if the device supports multiple sessions, but a session with that ID is already open. If the device supports multiple sessions, and the maximum number of sessions is open, the device should respond with Device_Busy. The SessionID and TransactionID in the OperationRequest data set shall be set to 0x00000000 for this operation.',
        parameters: [
            {
                name: 'SessionID',
                type: DataType.UINT32,
                description: 'Unique session identifier',
            },
        ],
    },

    CLOSE_SESSION: {
        code: 0x1003,
        description: 'Closes the session. Causes device to perform any session-specific clean-up.',
    },

    GET_DEVICE_INFO: {
        code: 0x1001,
        description:
            'Returns information and capabilities about the responder device by returning a DeviceInfo data set. This data set is described in 5.5.2. This operation is the only operation that may be issued inside or outside of a session. When used outside a session, both the SessionID and the TransactionID in the OperationRequest data set shall be set to 0x00000000.',
        respondsWithData: true,
        dataDescription: 'DeviceInfo dataset',
    },
    // Object operations
    GET_OBJECT_INFO: {
        code: 0x1008,
        description:
            'Returns the ObjectInfo data set, as described in 5.5.3. The primary purpose of this operation is to obtain information about a data object present on the device before deciding whether to retrieve that object or its thumbnail with a succeeding GetThumb or GetObject operation. This information may also be used by the caller to allocate memory before receiving the object. Objects that possess an ObjectFormat of type Association do not require a GetObject operation, as these objects are fully qualified by their ObjectInfo data set.',
        parameters: [
            {
                name: 'ObjectHandle',
                type: DataType.UINT32,
                description: 'Object handle',
            },
        ],
        respondsWithData: true,
        dataDescription: 'ObjectInfo dataset',
    },
    GET_OBJECT: {
        code: 0x1009,
        description:
            'Retrieves one object from the device. This operation is used for all types of data objects present on the device, including both images and non-image data objects, and should be preceded (although not necessarily immediately) by a GetObjectInfo operation that uses the same ObjectHandle. This operation is not necessary for objects of type Association, as these objects are fully qualified by their ObjectInfo data set. If the store that contains the object being sent is removed during the object transfer, the Incomplete_Transfer response should be used, along with the Store_Removed event.',
        parameters: [
            {
                name: 'objectHandle',
                type: DataType.UINT32,
                description: 'Handle of the object to retrieve',
            },
        ],
        respondsWithData: true,
        dataDescription: 'DataObject',
    },
    GET_DEVICE_PROP_VALUE: {
        code: 0x1015,
        description:
            'Returns the current value of a property. The size and format of the data returned from this operation should be determined from the corresponding DevicePropDesc data set returned from the GetDevicePropDesc operation. The current value of a property can also be retrieved directly from the DevicePropDesc, so this operation is not typically required unless a DevicePropChanged event occurs.',
        parameters: [
            {
                name: 'DevicePropCode',
                type: DataType.UINT16,
                description: 'Property code to get',
            },
        ],
        respondsWithData: true,
        dataDescription: 'DeviceProperty Value',
    },
    SET_DEVICE_PROP_VALUE: {
        code: 0x1016,
        description:
            'Sets the current value of the device property indicated by Parameter1 to the value indicated in the data phase of this operation. The format of the property value object sent in the data phase can be determined from the DatatypeCode field of the property’s DevicePropDesc data set. If the property is not settable, the response Access_Denied should be returned. If the value is not allowed by the device, Invalid_DeviceProp_Value should be returned. If the format or size of the property value is incorrect, Invalid_DeviceProp_Format should be returned.',
        parameters: [
            {
                name: 'DevicePropCode',
                type: DataType.UINT16,
                description: 'Property code to set',
            },
        ],
        expectsData: true,
        dataDescription: 'Device Property Value',
    },
} as const satisfies OperationDefinition

export type PTPOperationDefinitions = typeof PTPOperations
