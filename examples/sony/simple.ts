import { Camera } from '@api/camera'

const camera = new Camera()
await camera.connect()

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const results: Array<{prop: string, set: string, got: any}> = []

const testProperty = async (prop: string, value: string) => {
  await camera.setDeviceProperty(prop, value)
  await delay(500) // Let camera apply change
  const got = await camera.getDeviceProperty(prop)
  results.push({prop, set: value, got})
  await delay(500) // Visual delay
}

// Test aperture formats
await testProperty('APERTURE', '2.8')
await testProperty('APERTURE', 'f/4')
await testProperty('APERTURE', 'f5.6')
await testProperty('APERTURE', 'f 8')
await testProperty('APERTURE', 'ƒ/11')
await testProperty('APERTURE', 'F:16')
await testProperty('APERTURE', '22')

// Test ISO formats
await testProperty('ISO', '100')
await testProperty('ISO', 'ISO 200')
await testProperty('ISO', 'ISO400')
await testProperty('ISO', '00800')
await testProperty('ISO', '01600')
await testProperty('ISO', 'auto')
await testProperty('ISO', 'Auto')
await testProperty('ISO', 'ISO AUTO')
await testProperty('ISO', '3200')

// Test shutter speed formats
await testProperty('SHUTTER_SPEED', '30')
await testProperty('SHUTTER_SPEED', '15s')
await testProperty('SHUTTER_SPEED', '8"')
await testProperty('SHUTTER_SPEED', "4'")
await testProperty('SHUTTER_SPEED', '2sec')
await testProperty('SHUTTER_SPEED', '1 seconds')
await testProperty('SHUTTER_SPEED', '1/2')
await testProperty('SHUTTER_SPEED', '1/4s')
await testProperty('SHUTTER_SPEED', '1/8')
await testProperty('SHUTTER_SPEED', '1/15')
await testProperty('SHUTTER_SPEED', '1/30')
await testProperty('SHUTTER_SPEED', '1/60')
await testProperty('SHUTTER_SPEED', '1/125')
await testProperty('SHUTTER_SPEED', '1/250')
await testProperty('SHUTTER_SPEED', '1/500')
await testProperty('SHUTTER_SPEED', '1/1000')
await testProperty('SHUTTER_SPEED', '1/2000')
await testProperty('SHUTTER_SPEED', '1/4000')
await testProperty('SHUTTER_SPEED', '1/8000')
await testProperty('SHUTTER_SPEED', '0.5"')
await testProperty('SHUTTER_SPEED', '0.25')
await testProperty('SHUTTER_SPEED', '2.5"')
await testProperty('SHUTTER_SPEED', 'bulb')
await testProperty('SHUTTER_SPEED', 'BULB')
await testProperty('SHUTTER_SPEED', 'b')
await testProperty('SHUTTER_SPEED', 'B')

await camera.disconnect()

// Log all results
console.log('\nTest Results:')
console.log('=============\n')
results.forEach(r => {
  console.log(`${r.prop}: Set "${r.set}" → Got "${r.got}"`)
})

process.exit(0)
