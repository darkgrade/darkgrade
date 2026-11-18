import { fixtureBench } from '../fixture'
import { serveBench } from '../../server/http'
import { resolve } from 'node:path'
const { bench } = fixtureBench()
const app = serveBench(bench, { port: 5232, staticRoot: resolve(import.meta.dirname, '../../dist') })
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await app.close() })
