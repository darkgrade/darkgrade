export enum TransportType {
    USB = 'usb',
    IP = 'ip',
}

export interface TransportOptions {
    timeout?: number
    maxRetries?: number
    bufferSize?: number
}
