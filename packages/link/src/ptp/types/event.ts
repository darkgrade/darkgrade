import { CodecDefinition } from '@ptp/types/codec'

export interface EventParameter<T = number | bigint | string> {
    name: string
    description: string
    codec: CodecDefinition<T>
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

/**
 * Cross-platform EventEmitter implementation
 * Works in both Node.js and browser environments
 */

export type EventData = number | string | object | number[] | Record<string, any>
type EventListener<T = EventData> = (data: T) => void

export class EventEmitter {
    private events: Map<string, EventListener<any>[]> = new Map()

    on<T = EventData>(event: string, listener: EventListener<T>): this {
        return this.addListener(event, listener)
    }

    off<T = EventData>(event: string, listener: EventListener<T>): this {
        return this.removeListener(event, listener)
    }

    emit<T = EventData>(event: string, data: T): boolean {
        const listeners = this.events.get(event)
        if (listeners) {
            listeners.forEach(listener => {
                listener(data)
            })
            return true
        }
        return false
    }

    once<T = EventData>(event: string, listener: EventListener<T>): this {
        const onceWrapper = (data: T) => {
            this.removeListener(event, onceWrapper)
            listener(data)
        }
        return this.on(event, onceWrapper)
    }

    addListener<T = EventData>(event: string, listener: EventListener<T>): this {
        if (!this.events.has(event)) {
            this.events.set(event, [])
        }
        this.events.get(event)!.push(listener)
        return this
    }

    removeListener<T = EventData>(event: string, listener: EventListener<T>): this {
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
