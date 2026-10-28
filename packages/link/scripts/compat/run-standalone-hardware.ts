/**
 * Runs the compatibility capabilities against the camera on your desk, live in `bun run compat:ui`.
 *
 *   bun run compat:hardware -- --usb 04a9:3323                  # profile chosen by USB identity
 *   bun run compat:hardware -- --usb 04b0:0454 --profile nikon-z6-iii
 *   bun run compat:hardware -- --ip 192.168.1.2 --vendor canon --profile canon-eos-r6-mark-iii
 *
 * --profile takes any id the UI lists (captured profile, line mock or per-model mock); without it the
 * strongest profile for the USB identity is used. Results stream to test-results/compat-runs/, the
 * one-row matrix goes to test-results/camera-lab/, and the merged matrix is refreshed unless
 * --no-merge is given. Exits 1 when a capability fails, 2 when the camera cannot be selected.
 */
import { Logger } from '@core/logger'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { CAPABILITIES } from '@scripts/camera-profiles/camera-capabilities'
import { findProfileByUsb, loadProfileIndex, usbIdentities } from '@scripts/camera-profiles/profile-index'
import { refreshMergedMatrix } from '@scripts/camera-profiles/refresh-matrices'
import { runStandalone } from '@scripts/camera-profiles/standalone-run'
import { IPTransport } from '@transport/ip/ip-transport'
import { parseCode } from '@transport/simulated/camera-profile'
import { USBTransport } from '@transport/usb/usb-transport'
import path from 'node:path'

const PTP_STILL_IMAGE_CLASS = { classCode: 0x06, subclassCode: 0x01 }
const VENDORS: Record<string, number> = { canon: VendorIDs.CANON, nikon: VendorIDs.NIKON, sony: VendorIDs.SONY }

const argumentsList = process.argv.slice(2)
const valueAfter = (flag: string) => {
    const index = argumentsList.indexOf(flag)
    return index >= 0 ? argumentsList[index + 1] : undefined
}

function fail(message: string): never {
    console.error(message)
    process.exit(2)
}

const usbIdentity = valueAfter('--usb')?.toLowerCase()
const ipAddress = valueAfter('--ip')
const profileId = valueAfter('--profile')
if (!usbIdentity && !ipAddress) fail('Pass --usb vvvv:pppp or --ip host[:port] (see the header of this script).')
if (usbIdentity && !/^[0-9a-f]{4}:[0-9a-f]{4}$/.test(usbIdentity)) fail(`--usb ${usbIdentity} is not vvvv:pppp`)

const index = loadProfileIndex()
const entry = profileId ? index.get(profileId) : usbIdentity ? findProfileByUsb(index, usbIdentity) : undefined
if (!entry)
    fail(`No profile ${profileId ? `"${profileId}"` : `for USB ${usbIdentity}`}; pass --profile <id> from the UI.`)
const { profile } = entry

const logger = new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
const usb = usbIdentity ? [usbIdentity] : usbIdentities(profile)
const vendorName = valueAfter('--vendor')?.toLowerCase()
const vendorId =
    (vendorName ? VENDORS[vendorName] : undefined) ??
    (usb[0] ? Number.parseInt(usb[0].slice(0, 4), 16) : undefined) ??
    (profile.usb ? parseCode(profile.usb.vendorId) : undefined)

let connection: 'usb' | 'ptp-ip' = 'usb'
let transport
let device
if (ipAddress) {
    const [host, port] = ipAddress.split(':')
    connection = 'ptp-ip'
    transport = new IPTransport({ address: host, port: port ? Number(port) : undefined }, logger)
} else {
    const [vendor, product] = usbIdentity!.split(':').map(part => Number.parseInt(part, 16))
    transport = new USBTransport(logger)
    device = { usb: { filters: [{ vendorId: vendor, productId: product, ...PTP_STILL_IMAGE_CLASS }] } }
}

console.log(`Running ${CAPABILITIES.length} capabilities on ${profile.model} (${profile.id}) over ${connection}…`)
const startedAt = Date.now()
const result = await runStandalone({
    profile,
    profilePath: entry.path,
    transport,
    connection,
    ...(device && { device }),
    ...(vendorId !== undefined && { vendorId }),
    usb,
})
for (const capability of CAPABILITIES) {
    const outcome = result.row.results[capability.id]
    console.log(`${capability.label.padEnd(24)} ${outcome.status.padEnd(12)} ${outcome.detail}`)
}
console.log(
    `${((Date.now() - startedAt) / 1000).toFixed(1)} s; wrote ${path.relative(process.cwd(), result.matrixFile)}` +
        (result.runFile ? ` and ${path.relative(process.cwd(), result.runFile)}` : '')
)
if (!argumentsList.includes('--no-merge')) refreshMergedMatrix()
process.exit(Object.values(result.row.results).some(outcome => outcome.status === 'fail') ? 1 : 0)
