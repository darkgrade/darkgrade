/**
 * A value this window remembers in localStorage. `read` turns the stored text into a value, or
 * undefined when it is missing or not one; then the fallback is used. Storage that cannot be read or
 * written (a private window, a full quota) only means the value is not remembered.
 */
export function persisted<Value>(key: string, read: (stored: string | null) => Value | undefined, fallback: Value) {
    return {
        load(): Value {
            try {
                return read(localStorage.getItem(key)) ?? fallback
            } catch {
                return fallback
            }
        },
        save(value: Value, write: (value: Value) => string = String): void {
            try {
                localStorage.setItem(key, write(value))
            } catch {
                // Not remembered; the value still applies for this session.
            }
        },
    }
}
