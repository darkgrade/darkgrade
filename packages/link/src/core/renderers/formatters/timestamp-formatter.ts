export function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp)
    const hours24 = date.getHours()
    const hours = hours24 % 12 || 12
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const seconds = date.getSeconds().toString().padStart(2, '0')
    const millis = date.getMilliseconds().toString().padStart(3, '0')
    const ampm = hours24 >= 12 ? 'PM' : 'AM'
    return `${hours}:${minutes}:${seconds}.${millis} ${ampm}`
}
