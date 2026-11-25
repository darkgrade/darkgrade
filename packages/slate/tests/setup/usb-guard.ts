import { hardwareTestsEnabled } from '@tests/setup/hardware'
import { usb } from 'usb'

// node-usb's WebUSB, findByIds and findBySerialNumber all enumerate through this one function.
// Tests that need a device list spy on it (see usb-discovery-scope.test.ts) and still work.
if (!hardwareTestsEnabled) usb.getDeviceList = () => []
