/**
 * PTP's DateTime string: ISO 8601 basic, `YYYYMMDDThhmmss`, optionally with tenths and a zone, which
 * Slate reads as the camera's local wall time. ObjectInfo's capture date and the DateTime property
 * (0x5011) both use it.
 */
const PTP_DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/

/** The wall-clock fields a PTP DateTime names, as written, or undefined when it is not one. */
export function ptpDateTimeFields(value: unknown): [string, string, string, string, string, string] | undefined {
    const match = typeof value === 'string' ? PTP_DATE_TIME.exec(value) : null
    return match ? [match[1]!, match[2]!, match[3]!, match[4]!, match[5]!, match[6]!] : undefined
}

/** A moment in the host's local wall time as a PTP DateTime. */
export function ptpDateTimeString(moment: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0')
    return (
        `${moment.getFullYear()}${pad(moment.getMonth() + 1)}${pad(moment.getDate())}` +
        `T${pad(moment.getHours())}${pad(moment.getMinutes())}${pad(moment.getSeconds())}`
    )
}
