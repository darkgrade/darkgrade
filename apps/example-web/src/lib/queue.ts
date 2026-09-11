import { store } from './store.svelte'

class CameraQueue {
    private queue: (() => Promise<any>)[] = []
    private processing = false

    async push<T>(operation: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await operation()
                    resolve(result)
                    return result
                } catch (error) {
                    reject(error)
                    throw error
                }
            })
            this.processQueue()
        })
    }

    private async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return
        }

        this.processing = true
        store.queueProcessing = true

        while (this.queue.length > 0) {
            const operation = this.queue.shift()!

            try {
                await operation()
            } catch (error) {
                console.error('Camera operation failed:', error)
                // Continue processing other operations even if one fails
            }
        }

        this.processing = false
        store.queueProcessing = false
    }

    // Get queue status for debugging
    getQueueStatus() {
        return {
            queueLength: this.queue.length,
            processing: this.processing,
        }
    }
}

// Export a singleton instance
export const cameraQueue = new CameraQueue()
