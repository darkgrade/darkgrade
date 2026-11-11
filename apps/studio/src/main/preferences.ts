import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Preferences } from '@shared/ipc'

export const DEFAULT_PREFERENCES: Preferences = {
    mcpServerEnabled: false,
    mcpServerPort: 7461,
}

/** Studio's settings, kept as JSON in Application Support and read once at launch. */
class PreferencesStore {
    private current: Preferences | null = null
    private listeners = new Set<(preferences: Preferences) => void>()

    private get path(): string {
        return join(app.getPath('userData'), 'preferences.json')
    }

    get(): Preferences {
        if (this.current) return this.current
        try {
            const saved = existsSync(this.path) ? (JSON.parse(readFileSync(this.path, 'utf8')) as Partial<Preferences>) : {}
            this.current = { ...DEFAULT_PREFERENCES, ...saved }
        } catch {
            this.current = { ...DEFAULT_PREFERENCES }
        }
        return this.current
    }

    set(change: Partial<Preferences>): Preferences {
        this.current = { ...this.get(), ...change }
        writeFileSync(this.path, JSON.stringify(this.current, null, 4))
        this.listeners.forEach(listener => listener(this.current!))
        return this.current
    }

    onChange(listener: (preferences: Preferences) => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }
}

export const preferences = new PreferencesStore()
