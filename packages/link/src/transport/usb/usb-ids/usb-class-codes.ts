export const USB_CLASS_NAMES: Record<number, string> = {
    0x00: 'Device',
    0x01: 'Audio',
    0x02: 'Comm/CDC',
    0x03: 'HID',
    0x05: 'Physical',
    0x06: 'Image',
    0x07: 'Printer',
    0x08: 'Mass Storage',
    0x09: 'Hub',
    0x0a: 'CDC-Data',
    0x0b: 'Smart Card',
    0x0d: 'Content Security',
    0x0e: 'Video',
    0x0f: 'Personal Healthcare',
    0x10: 'Audio/Video',
    0x11: 'Billboard',
    0x12: 'Type-C Bridge',
    0x13: 'Bulk Display',
    0x14: 'MCTP over USB Endpoint',
    0x3c: 'I3C',
    0xdc: 'Diagnostic',
    0xe0: 'Wireless',
    0xef: 'Miscellaneous',
    0xfe: 'Application',
    0xff: 'Vendor',
}

export const USB_SUBCLASS_NAMES: Record<string, string> = {
    '0x06:0x01': 'Still Image',
    '0x09:0x00': 'Full Speed Hub',
    '0x09:0x01': 'Hi-Speed Hub (Single TT)',
    '0x09:0x02': 'Hi-Speed Hub (Multi TT)',
}

export function getClassName(classCode?: number): string {
    if (classCode === undefined) return 'Unknown'
    return USB_CLASS_NAMES[classCode] || `Class 0x${classCode.toString(16).padStart(2, '0')}`
}

export function getSubclassName(classCode?: number, subclassCode?: number): string {
    if (classCode === undefined || subclassCode === undefined) return 'Unknown'
    const key = `0x${classCode.toString(16).padStart(2, '0')}:0x${subclassCode.toString(16).padStart(2, '0')}`
    const subclassName = USB_SUBCLASS_NAMES[key]
    if (subclassName) return subclassName

    // If no specific subclass name, just show the class name
    const className = USB_CLASS_NAMES[classCode]
    if (className && subclassCode === 0x00) return className

    return `${className || 'Class 0x' + classCode.toString(16).padStart(2, '0')} / Subclass 0x${subclassCode.toString(16).padStart(2, '0')}`
}
