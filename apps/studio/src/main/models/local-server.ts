import { createServer } from 'node:net'

/** A port nothing on this Mac is listening on, for a model server to take. */
export function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            const port = typeof address === 'object' && address ? address.port : 0
            server.close(() => resolve(port))
        })
    })
}

/** Whether the model server on `port` answers its health check (it does once its model is loaded). */
export async function isHealthy(port: number): Promise<boolean> {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/health`)
        return response.ok
    } catch {
        return false
    }
}
