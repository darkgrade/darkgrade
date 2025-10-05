import { Logger, NewLog } from '../logger'
import { operationDefinitions } from '../../ptp/definitions/operation-definitions'

// Timing constants
const PHASE_DURATION = 500 // Time between phases (request → data → response)
const OPERATION_GAP = 500 // Time between operations

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function populateMockData(logger: Logger<typeof operationDefinitions>) {
    const sessionId = 0x00012345
    let transactionId = 1

    // 1. OpenSession
    const openSessionId = logger.addLog({
        type: 'ptp_operation' as const,
        level: 'info' as const,
        sessionId,
        transactionId,
        requestPhase: {
            timestamp: Date.now(),
            operationName: 'OpenSession' as const,
            encodedParams: [new Uint8Array([0x45, 0x23, 0x01, 0x00])],
            decodedParams: {
                SessionID: sessionId,
            },
        },
    })

    logger.addLog({
        type: 'usb_transfer',
        level: 'debug',
        sessionId,
        transactionId,
        direction: 'send',
        bytes: 16,
        endpoint: 'bulkOut',
        endpointAddress: '0x02',
        phase: 'request',
    })

    await sleep(PHASE_DURATION)

    logger.updateLog(openSessionId, {
        responsePhase: {
            timestamp: Date.now(),
            code: 0x2001, // OK
        },
    })

    logger.addLog({
        type: 'usb_transfer',
        level: 'debug',
        sessionId,
        transactionId,
        direction: 'receive',
        bytes: 12,
        endpoint: 'bulkIn',
        endpointAddress: '0x81',
        phase: 'response',
    })

    await sleep(OPERATION_GAP)

    // 2. GetDeviceInfo with full device data
    transactionId++
    const getDeviceInfoId = logger.addLog({
        type: 'ptp_operation',
        level: 'info',
        sessionId,
        transactionId,
        requestPhase: {
            timestamp: Date.now(),
            operationName: 'GetDeviceInfo',
            encodedParams: [],
            decodedParams: {},
        },
    })

    logger.addLog({
        type: 'usb_transfer',
        level: 'debug',
        sessionId,
        transactionId,
        direction: 'send',
        bytes: 12,
        endpoint: 'bulkOut',
        endpointAddress: '0x02',
        phase: 'request',
    })

    await sleep(PHASE_DURATION)

    logger.updateLog(getDeviceInfoId, {
        dataPhase: {
            timestamp: Date.now(),
            direction: 'out',
            bytes: 382,
            encodedData: new Uint8Array([
                0x64, 0x00, 0x06, 0x00, 0x53, 0x00, 0x6f, 0x00,
                0x6e, 0x00, 0x79, 0x00, 0x20, 0x00, 0x43, 0x00
            ]),
            decodedData: {
                StandardVersion: 100,
                VendorExtensionID: 0x00000006,
                VendorExtensionVersion: 100,
                VendorExtensionDesc: 'Sony Corporation',
                FunctionalMode: 0,
                OperationsSupported: [
                    0x1001, 0x1002, 0x1003, 0x1004, 0x1005, 0x1006, 0x1007, 0x1008,
                    0x1009, 0x100a, 0x100b, 0x100c, 0x100d, 0x100e, 0x100f, 0x1014,
                    0x1015, 0x1016, 0x101b, 0x9201, 0x9202, 0x9203
                ],
                EventsSupported: [0x4001, 0x4002, 0x4003, 0x4004, 0x4005, 0x4006, 0xc201, 0xc202],
                DevicePropertiesSupported: [
                    0x5001, 0x5002, 0x5003, 0x5004, 0x5005, 0x5007, 0x5008, 0x500a,
                    0x500b, 0x500c, 0x500d, 0x500e, 0x500f, 0xd001, 0xd002
                ],
                CaptureFormats: [0x3000, 0x3001, 0x3800, 0x3801, 0xb101],
                ImageFormats: [0x3000, 0x3001, 0x3800, 0x3801],
                Manufacturer: 'Sony Corporation',
                Model: 'ILCE-7M4',
                DeviceVersion: '2.01',
                SerialNumber: '00000000000000000012345678',
            },
        },
    })

    logger.addLog({
        type: 'usb_transfer',
        level: 'debug',
        sessionId,
        transactionId,
        direction: 'receive',
        bytes: 394,
        endpoint: 'bulkIn',
        endpointAddress: '0x81',
        phase: 'data',
    })

    await sleep(PHASE_DURATION)

    logger.updateLog(getDeviceInfoId, {
        responsePhase: {
            timestamp: Date.now(),
            code: 0x2001,
        },
    })

    logger.addLog({
        type: 'usb_transfer',
        level: 'debug',
        sessionId,
        transactionId,
        direction: 'receive',
        bytes: 12,
        endpoint: 'bulkIn',
        endpointAddress: '0x81',
        phase: 'response',
    })

    await sleep(OPERATION_GAP)

    // 3. GetDevicePropValue - ExposureCompensation
    transactionId++
    const getPropId = logger.addLog({
        type: 'ptp_operation',
        level: 'info',
        sessionId,
        transactionId,
        requestPhase: {
            timestamp: Date.now(),
            operationName: 'GetDevicePropValue',
            encodedParams: [new Uint8Array([0x02, 0x50])],
            decodedParams: {
                DevicePropCode: 0x5002,
            },
        },
    })

    logger.addLog({
        type: 'usb_transfer',
        level: 'debug',
        sessionId,
        transactionId,
        direction: 'send',
        bytes: 16,
        endpoint: 'bulkOut',
        endpointAddress: '0x02',
        phase: 'request',
    })

    await sleep(PHASE_DURATION)

    logger.updateLog(getPropId, {
        dataPhase: {
            timestamp: Date.now(),
            direction: 'out',
            bytes: 2,
            encodedData: new Uint8Array([0x00, 0x00]),
            decodedData: 0,
        },
    })

    logger.addLog({
        type: 'usb_transfer',
        level: 'debug',
        sessionId,
        transactionId,
        direction: 'receive',
        bytes: 14,
        endpoint: 'bulkIn',
        endpointAddress: '0x81',
        phase: 'data',
    })

    await sleep(PHASE_DURATION)

    logger.updateLog(getPropId, {
        responsePhase: {
            timestamp: Date.now(),
            code: 0x2001,
        },
    })

    logger.addLog({
        type: 'usb_transfer',
        level: 'debug',
        sessionId,
        transactionId,
        direction: 'receive',
        bytes: 12,
        endpoint: 'bulkIn',
        endpointAddress: '0x81',
        phase: 'response',
    })

    await sleep(OPERATION_GAP)

    // 4. SetDevicePropValue - ISO (FAILS with DeviceBusy)
    transactionId++
    const setISOId = logger.addLog({
        type: 'ptp_operation',
        level: 'error',
        sessionId,
        transactionId,
        requestPhase: {
            timestamp: Date.now(),
            operationName: 'SetDevicePropValue',
            encodedParams: [new Uint8Array([0x04, 0x50])],
            decodedParams: {
                DevicePropCode: 0x5004,
            },
        },
    })

    logger.addLog({
        type: 'usb_transfer',
        level: 'debug',
        sessionId,
        transactionId,
        direction: 'send',
        bytes: 16,
        endpoint: 'bulkOut',
        endpointAddress: '0x02',
        phase: 'request',
    })

    await sleep(PHASE_DURATION)

    logger.updateLog(setISOId, {
        dataPhase: {
            timestamp: Date.now(),
            direction: 'in',
            bytes: 4,
            encodedData: new Uint8Array([0x20, 0x03, 0x00, 0x00]),
            decodedData: 800,
        },
    })

    logger.addLog({
        type: 'usb_transfer',
        level: 'debug',
        sessionId,
        transactionId,
        direction: 'send',
        bytes: 16,
        endpoint: 'bulkOut',
        endpointAddress: '0x02',
        phase: 'data',
    })

    await sleep(PHASE_DURATION)

    logger.updateLog(setISOId, {
        responsePhase: {
            timestamp: Date.now(),
            code: 0x2019, // DeviceBusy
        },
    })

    logger.addLog({
        type: 'usb_transfer',
        level: 'debug',
        sessionId,
        transactionId,
        direction: 'receive',
        bytes: 12,
        endpoint: 'bulkIn',
        endpointAddress: '0x81',
        phase: 'response',
    })

    await sleep(OPERATION_GAP)

    // 5. GetObject - Large JPEG file
    transactionId++
    const getObjectId = logger.addLog({
        type: 'ptp_operation',
        level: 'debug',
        sessionId,
        transactionId,
        requestPhase: {
            timestamp: Date.now(),
            operationName: 'GetObject',
            encodedParams: [new Uint8Array([0x01, 0x00, 0x01, 0x00])],
            decodedParams: {
                ObjectHandle: 0x00010001,
            },
        },
    })

    logger.addLog({
        type: 'usb_transfer',
        level: 'debug',
        sessionId,
        transactionId,
        direction: 'send',
        bytes: 16,
        endpoint: 'bulkOut',
        endpointAddress: '0x02',
        phase: 'request',
    })

    await sleep(PHASE_DURATION)

    logger.updateLog(getObjectId, {
        dataPhase: {
            timestamp: Date.now(),
            direction: 'out',
            bytes: 3145728, // 3MB JPEG
            encodedData: new Uint8Array([
                0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
                0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01
            ]),
            decodedData: null,
            maxDataLength: 5242880, // 5MB buffer
        },
    })

    logger.addLog({
        type: 'usb_transfer',
        level: 'debug',
        sessionId,
        transactionId,
        direction: 'receive',
        bytes: 3145740,
        endpoint: 'bulkIn',
        endpointAddress: '0x81',
        phase: 'data',
    })

    await sleep(PHASE_DURATION)

    logger.updateLog(getObjectId, {
        responsePhase: {
            timestamp: Date.now(),
            code: 0x2001,
        },
    })

    logger.addLog({
        type: 'usb_transfer',
        level: 'debug',
        sessionId,
        transactionId,
        direction: 'receive',
        bytes: 12,
        endpoint: 'bulkIn',
        endpointAddress: '0x81',
        phase: 'response',
    })

    await sleep(OPERATION_GAP)

    // 6. Streaming GetObject calls (simulate live view)
    for (let i = 0; i < 3; i++) {
        transactionId++
        const streamId = logger.addLog({
            type: 'ptp_operation',
            level: 'debug',
            sessionId,
            transactionId,
            requestPhase: {
                timestamp: Date.now(),
                operationName: 'GetObject',
                encodedParams: [new Uint8Array([0x02, 0x00, 0x01, 0x00])],
                decodedParams: {
                    ObjectHandle: 0x00010002,
                },
            },
        })

        logger.addLog({
            type: 'usb_transfer',
            level: 'debug',
            sessionId,
            transactionId,
            direction: 'send',
            bytes: 16,
            endpoint: 'bulkOut',
            endpointAddress: '0x02',
            phase: 'request',
        })

        await sleep(PHASE_DURATION)

        logger.updateLog(streamId, {
            dataPhase: {
                timestamp: Date.now(),
                direction: 'out',
                bytes: 51200, // 50KB frame
                encodedData: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
                decodedData: null,
            },
        })

        logger.addLog({
            type: 'usb_transfer',
            level: 'debug',
            sessionId,
            transactionId,
            direction: 'receive',
            bytes: 51212,
            endpoint: 'bulkIn',
            endpointAddress: '0x81',
            phase: 'data',
        })

        await sleep(PHASE_DURATION)

        logger.updateLog(streamId, {
            responsePhase: {
                timestamp: Date.now(),
                code: 0x2001,
            },
        })

        logger.addLog({
            type: 'usb_transfer',
            level: 'debug',
            sessionId,
            transactionId,
            direction: 'receive',
            bytes: 12,
            endpoint: 'bulkIn',
            endpointAddress: '0x81',
            phase: 'response',
        })

        await sleep(OPERATION_GAP)
    }
}
