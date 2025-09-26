/**
 * PTP Operations with type validation
 */

import { DataType, OperationDefinitions } from '@constants/types'

/**
 * PTP Operations with type validation
 */
export const PTPOperations = {
    OPEN_SESSION: {
        code: 0x1002,
        name: 'OPEN_SESSION',
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
        name: 'CLOSE_SESSION',
        description: 'Closes the session. Causes device to perform any session-specific clean-up.',
    },

    GET_DEVICE_INFO: {
        code: 0x1001,
        name: 'GET_DEVICE_INFO',
        description:
            'Returns information and capabilities about the responder device by returning a DeviceInfo data set. This data set is described in 5.5.2. This operation is the only operation that may be issued inside or outside of a session. When used outside a session, both the SessionID and the TransactionID in the OperationRequest data set shall be set to 0x00000000.',
        respondsWithData: true,
        dataDescription: 'DeviceInfo dataset',
    },
    GET_OBJECT_INFO: {
        code: 0x1008,
        name: 'GET_OBJECT_INFO',
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
        name: 'GET_OBJECT',
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
    GET_OBJECT_HANDLES: {
        code: 0x1007,
        name: 'GET_OBJECT_HANDLES',
        description:
            ' returns an array of ObjectHandles present in the store indicated by the StorageID in the first parameter. If an aggregated list across all stores is desired, this value shall be set to 0xFFFFFFFF. Arrays are described in 5.4. The second parameter is optional, and may or may not be supported. This parameter allows the initiator to ask for only the handles that represent data objects that possess a format specified by the ObjectFormatCode. If a list of handles that represent only image objects is desired, this second parameter may be set to 0xFFFFFFFF. If it is not used, it shall be set to 0x00000000. If the value is non-zero, and the responder does not support specification by ObjectFormatCode, it should fail the operation by returning a ResponseCode with the value of Specification_By_Format_Unsupported. If a single store is specified, and the store is unavailable because of media removal, this operation should return Store_Not_Available. The third parameter is optional, and may be used to request only a list of the handles of objects that belong to a particular association. If the third parameter is a valid ObjectHandle for an Association, this operation should return only a list of ObjectHandles of objects that are direct children of the Association, and therefore only ObjectHandles that refer to objects that possess an ObjectInfo data set with the ParentObject field set to the value indicated in the third parameter. If a list of only those ObjectHandles corresponding to objects in the “root” of a store is desired, this parameter may be set to 0xFFFFFFFF. If the ObjectHandle referred to is not a valid ObjectHandle, the appropriate response is Invalid_ObjectHandle. If this parameter is specified and is a valid ObjectHandle, but the object referred to is not an association, the response Invalid_ParentObject should be returned. If the third parameter is unused, this operation returns ObjectHandles aggregated across the entire device (modified by the second parameter), and the third parameter should be set to 0x00000000.',
        parameters: [
            {
                name: 'storageId',
                type: DataType.UINT32,
                description: 'Storage ID',
            },
        ],
        dataDescription: 'Array of object handles',
        respondsWithData: true,
    },
    GET_STORAGE_IDS: {
        code: 0x1004,
        name: 'GET_STORAGE_IDS',
        description:
            'Returns a list of the currently valid StorageIDs. This array shall contain one StorageID for each valid logical store. One StorageID should also be present for each removable medium that is not inserted, which would contain a non-zero PhysicalStorageID and a LogicalStorageID with the value 0x0000.',
        respondsWithData: true,
        dataDescription: 'Array of storage IDs',
    },
    GET_STORAGE_INFO: {
        code: 0x1005,
        name: 'GET_STORAGE_INFO',
        description:
            'Returns a StorageInfo data set for the particular storage area indicated in the first parameter. This data set is defined in 5.5.4.',
        parameters: [
            {
                name: 'storageId',
                type: DataType.UINT32,
                description: 'Storage ID',
            },
        ],
        dataDescription: 'StorageInfo dataset',
        respondsWithData: true,
    },
    GET_DEVICE_PROP_VALUE: {
        code: 0x1015,
        name: 'GET_DEVICE_PROP_VALUE',
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
        name: 'SET_DEVICE_PROP_VALUE',
        description:
            'Sets the current value of the device property indicated by Parameter1 to the value indicated in the data phase of this operation. ' +
            "The format of the property value object sent in the data phase can be determined from the DatatypeCode field of the property's DevicePropDesc data set. " +
            'If the property is not settable, the response Access_Denied should be returned. If the value is not allowed by the device, Invalid_DeviceProp_Value should be returned. ' +
            'If the format or size of the property value is incorrect, Invalid_DeviceProp_Format should be returned.',
        parameters: [
            {
                name: 'DevicePropCode',
                type: DataType.UINT16,
                description: 'Property code to set',
                possibleValues: [
                    {
                        name: 'Battery Level',
                        description: 'Current battery level of the device',
                        value: 0x5001,
                    },
                    {
                        name: 'White Balance',
                        description: 'White balance setting',
                        value: 0x5005,
                    },
                    {
                        name: 'F-Number',
                        description: 'Aperture f-stop value',
                        value: 0x5007,
                    },
                ],
            },
        ],
        expectsData: true,
        dataDescription: 'Device Property Value',
    },
} as const satisfies OperationDefinitions

export type PTPOperationDefinitions = typeof PTPOperations
