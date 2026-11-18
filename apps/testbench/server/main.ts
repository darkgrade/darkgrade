import { Camera } from '@darkgrade/link'
import { LocalBench } from './host'
import { serveBench } from './http'
import { resolve } from 'node:path'

const logger = { renderInTerminal: false, captureConsole: false }
const bench = new LocalBench({
    discover: () => Camera.discover(),
    create: device => new Camera({ logger,
        device: { usb: { filters: [{ vendorId: device.vendorId, productId: device.productId,
            ...(device.serialNumber ? { serialNumber: device.serialNumber } : {}) }] } },
        transactionPolicy: { automaticUSBReset: false, deviceBusyRetries: 0, timeoutMilliseconds: 8000 },
    }),
})
const application = serveBench(bench, { staticRoot: resolve(import.meta.dirname, '../dist') })
console.log(`Test Bench: http://localhost:${application.server.port} · scan to connect your USB cameras`)
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => {
    if (stopping) return
    stopping = true
    try { await application.close(); process.exitCode = 0 }
    catch (error) { console.error(error instanceof Error ? error.message : 'Camera cleanup failed'); process.exitCode = 1 }
})
