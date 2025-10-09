export interface EventParameter {
    name: string
    description: string
    type: string
}

export interface EventDefinition {
    code: number
    name: string
    description: string
    sessionId?: string
    transactionId?: string
    parameters: [EventParameter?, EventParameter?, EventParameter?]
}

export type EventCode = number

export function isStandardEventCode(code: number): boolean {
    return (code & 0xf000) === 0x4000
}

export function isVendorEventCode(code: number): boolean {
    return (code & 0x8000) === 0x8000 && (code & 0xf000) === 0xc000
}

/**
 * Cross-platform EventEmitter implementation
 * Works in both Node.js and browser environments
 */

type EventListener = (...args: any[]) => void

export class EventEmitter {
    private events: Map<string, EventListener[]> = new Map()

    on(event: string, listener: EventListener): this {
        return this.addListener(event, listener)
    }

    off(event: string, listener: EventListener): this {
        return this.removeListener(event, listener)
    }

    emit(event: string, ...args: any[]): boolean {
        const listeners = this.events.get(event)
        if (listeners) {
            listeners.forEach(listener => {
                listener(...args)
            })
            return true
        }
        return false
    }

    once(event: string, listener: EventListener): this {
        const onceWrapper = (...args: any[]) => {
            this.removeListener(event, onceWrapper)
            listener(...args)
        }
        return this.on(event, onceWrapper)
    }

    addListener(event: string, listener: EventListener): this {
        if (!this.events.has(event)) {
            this.events.set(event, [])
        }
        this.events.get(event)!.push(listener)
        return this
    }

    removeListener(event: string, listener: EventListener): this {
        const listeners = this.events.get(event)
        if (listeners) {
            const index = listeners.indexOf(listener)
            if (index !== -1) {
                listeners.splice(index, 1)
            }
            if (listeners.length === 0) {
                this.events.delete(event)
            }
        }
        return this
    }

    removeAllListeners(event?: string): this {
        if (event) {
            this.events.delete(event)
        } else {
            this.events.clear()
        }
        return this
    }

    listenerCount(event: string): number {
        const listeners = this.events.get(event)
        return listeners ? listeners.length : 0
    }

    eventNames(): string[] {
        return Array.from(this.events.keys())
    }
}
