/** The existing host queue, also used by connected camera control/confirmation workflows. */
export class CameraOperationQueue {
    private readonly operations = new Map<string, Promise<unknown>>()

    async run<T>(camera: string, operation: () => Promise<T>): Promise<T> {
        if (typeof camera !== 'string' || !camera.trim()) throw new Error('A camera identity is required')
        const previous = this.operations.get(camera) ?? Promise.resolve()
        const pending = previous.catch(() => undefined).then(operation)
        this.operations.set(camera, pending)
        try {
            return await pending
        } finally {
            if (this.operations.get(camera) === pending) this.operations.delete(camera)
        }
    }
}
