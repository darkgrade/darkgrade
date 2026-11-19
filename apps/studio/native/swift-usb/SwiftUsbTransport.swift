// EXPERIMENT(usb-transport): the camera's USB connection in Swift, on Apple's IOUSBHost, in place of node-usb.
// This file is the whole transport: open, close, one container out, one container in, the still-image class reset
// and the interrupt endpoint's events. Studio hands it to Link as its transport (src/main/usb-experiments.ts); Link's
// commands pass through unchanged. Removing the Developer Mode "USB Transport" choice removes this folder.
import Foundation
import IOKit
import IOUSBHost

public typealias DoneCallback = @convention(c) (UnsafeMutableRawPointer?, Int32) -> Void
public typealias DataCallback = @convention(c) (UnsafeMutableRawPointer?, Int32, UnsafePointer<UInt8>?, Int) -> Void

let containerCommand: UInt16 = 1
let containerData: UInt16 = 2
let containerResponse: UInt16 = 3
private let readTimeoutSeconds = 15.0
/** kUSBHostReturnPipeStalled */
private let pipeStalled = Int(Int32(bitPattern: 0xE000_5000))

private var timebase: mach_timebase_info_data_t = {
    var info = mach_timebase_info_data_t()
    mach_timebase_info(&info)
    return info
}()

/** Seconds on the clock mach_wait_until sleeps against. */
func now() -> Double {
    Double(mach_absolute_time()) * Double(timebase.numer) / Double(timebase.denom) / 1e9
}

/** Sleeps this thread until a time on now()'s clock. */
func sleep(until time: Double) {
    mach_wait_until(UInt64(time * 1e9 * Double(timebase.denom) / Double(timebase.numer)))
}

final class SwiftUsbTransport {
    static let shared = SwiftUsbTransport()

    /** Link's transfers run here in order; each takes `pipes` for its own duration. */
    private let queue = DispatchQueue(label: "studio.swift-usb", qos: .userInteractive)
    /**
     * Held for every transfer on the bulk pipes, so anything else that uses them (the Swift live-view loop, for a
     * whole transaction of its own) never interleaves with Link on the wire. Signalled when Link's transaction ends.
     */
    let pipes = NSCondition()
    /** Link has sent a command and not yet read its response (guarded by `pipes`). */
    var transactionOpenSince: Double?
    /** Run before the pipes close, so whatever else uses them can finish the transaction it is in. */
    var beforeClose: (() -> Void)?

    private var interface: IOUSBHostInterface?
    private var bulkIn: IOUSBHostPipe?
    private var bulkOut: IOUSBHostPipe?
    private var interrupt: IOUSBHostPipe?
    private var interfaceNumber: UInt16 = 0
    private let readBuffer = NSMutableData(length: 1 << 20)!

    func open(vendor: Int32, product: Int32) -> Bool {
        close()
        var iterator: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOUSBHostInterface"), &iterator) == KERN_SUCCESS
        else { return false }
        defer { IOObjectRelease(iterator) }
        var service: io_service_t = 0
        while case let candidate = IOIteratorNext(iterator), candidate != 0 {
            let property = { (key: String) in
                (IORegistryEntryCreateCFProperty(candidate, key as CFString, nil, 0)?.takeRetainedValue() as? NSNumber)?
                    .int32Value ?? -1
            }
            // The still-image class interface of the camera asked for.
            if property("idVendor") == vendor, product <= 0 || property("idProduct") == product,
                property("bInterfaceClass") == 6
            {
                service = candidate
                break
            }
            IOObjectRelease(candidate)
        }
        guard service != 0 else { return false }
        defer { IOObjectRelease(service) }
        guard let opened = try? IOUSBHostInterface(__ioService: service, options: [], queue: nil, interestHandler: nil)
        else { return false }
        interface = opened
        interfaceNumber = UInt16(opened.interfaceDescriptor.pointee.bInterfaceNumber)
        var endpoint: UnsafePointer<IOUSBEndpointDescriptor>?
        while let next = IOUSBGetNextEndpointDescriptor(
            opened.configurationDescriptor, opened.interfaceDescriptor,
            UnsafeRawPointer(endpoint)?.assumingMemoryBound(to: IOUSBDescriptorHeader.self))
        {
            endpoint = next
            let address = next.pointee.bEndpointAddress
            let kind = next.pointee.bmAttributes & 3
            guard let pipe = try? opened.copyPipe(withAddress: Int(address)) else { continue }
            if kind == 2, address & 0x80 != 0 { bulkIn = pipe }
            if kind == 2, address & 0x80 == 0 { bulkOut = pipe }
            if kind == 3, address & 0x80 != 0 { interrupt = pipe }
        }
        if bulkIn == nil || bulkOut == nil {
            close()
            return false
        }
        return true
    }

    func close() {
        beforeClose?()
        for pipe in [interrupt, bulkIn, bulkOut] { try? pipe?.__abort(with: .synchronous) }
        interface?.destroy()
        interface = nil
        bulkIn = nil
        bulkOut = nil
        interrupt = nil
        pipes.lock()
        transactionOpenSince = nil
        pipes.unlock()
    }

    // MARK: Link's transactions

    func send(_ data: Data, context: UnsafeMutableRawPointer?, done: DoneCallback) {
        queue.async {
            self.pipes.lock()
            if data.count >= 6, data.withUnsafeBytes({ $0.load(fromByteOffset: 4, as: UInt16.self) }) == containerCommand {
                self.transactionOpenSince = now()
            }
            let sent = self.write(buffer: NSMutableData(data: data))
            self.pipes.unlock()
            done(context, sent ? 0 : -1)
        }
    }

    func receive(maxLength: Int, context: UnsafeMutableRawPointer?, done: DataCallback) {
        queue.async {
            self.pipes.lock()
            let container = self.readContainer(limit: maxLength)
            if let container, container.count >= 6,
                container.withUnsafeBytes({ $0.load(fromByteOffset: 4, as: UInt16.self) }) == containerResponse
            {
                self.transactionOpenSince = nil
                self.pipes.broadcast()
            }
            self.pipes.unlock()
            guard let container else { return done(context, -1, nil, 0) }
            container.withUnsafeBytes { done(context, 0, $0.bindMemory(to: UInt8.self).baseAddress, container.count) }
        }
    }

    /** Still-image class Device Reset Request: the camera drops the transaction in progress. */
    func reset() -> Bool {
        guard let interface else { return false }
        let request = IOUSBDeviceRequest(
            bmRequestType: 0x21, bRequest: 0x66, wValue: 0, wIndex: interfaceNumber, wLength: 0)
        let ok = (try? interface.__send(request, data: nil, bytesTransferred: nil, completionTimeout: 2)) != nil
        pipes.lock()
        transactionOpenSince = nil
        pipes.broadcast()
        pipes.unlock()
        return ok
    }

    /** The interrupt endpoint's packets (the camera's events), each handed to `callback` as it arrives. */
    func listenForEvents(context: UnsafeMutableRawPointer?, callback: DataCallback) {
        guard let pipe = interrupt else { return }
        Thread {
            let buffer = NSMutableData(length: 64)!
            while self.interrupt === pipe {
                var length = 0
                do {
                    try pipe.__sendIORequest(with: buffer, bytesTransferred: &length, completionTimeout: 0)
                } catch {
                    if self.interrupt !== pipe { return }
                    Thread.sleep(forTimeInterval: 0.05)
                    continue
                }
                if length > 0 { callback(context, 0, buffer.bytes.assumingMemoryBound(to: UInt8.self), length) }
            }
        }.start()
    }

    // MARK: Transfers (call with `pipes` held)

    /** One transfer; a halted endpoint (left by an interrupted transaction) is cleared and tried once more. */
    private func transfer(on pipe: IOUSBHostPipe, buffer: NSMutableData, transferred: inout Int) -> Bool {
        for attempt in 1...2 {
            do {
                try pipe.__sendIORequest(with: buffer, bytesTransferred: &transferred, completionTimeout: readTimeoutSeconds)
                return true
            } catch {
                guard attempt == 1, (error as NSError).code == pipeStalled, (try? pipe.clearStall()) != nil else { return false }
            }
        }
        return false
    }

    /** One bulk-OUT transfer of the caller's buffer, as it is: no copy. */
    func write(buffer: NSMutableData) -> Bool {
        guard let bulkOut else { return false }
        var sent = 0
        return transfer(on: bulkOut, buffer: buffer, transferred: &sent)
    }

    /** One bulk-IN transfer into the caller's buffer, up to its length: the number of bytes that arrived, or nil. */
    func read(into buffer: NSMutableData) -> Int? {
        guard let bulkIn else { return nil }
        var length = 0
        return transfer(on: bulkIn, buffer: buffer, transferred: &length) ? length : nil
    }

    /** One whole container, copied out: reads past the first transfer when the container says it's longer. */
    private func readContainer(limit: Int) -> Data? {
        var container = Data()
        var declared = 0
        repeat {
            readBuffer.length = 1 << 20
            guard let length = read(into: readBuffer) else { return nil }
            // A zero-length packet ends a packet-aligned data phase: the container continues in the next read.
            if length == 0 { continue }
            container.append(readBuffer.bytes.assumingMemoryBound(to: UInt8.self), count: length)
            if declared == 0, container.count >= 4 {
                declared = Int(container.withUnsafeBytes { $0.load(as: UInt32.self) })
                if declared > limit || declared < 12 { return nil }
            }
        } while container.count < declared
        return container
    }
}

// MARK: C entry points for the Node-API glue (addon.c)

@_cdecl("su_open") public func su_open(_ vendor: Int32, _ product: Int32) -> Int32 {
    SwiftUsbTransport.shared.open(vendor: vendor, product: product) ? 1 : 0
}

@_cdecl("su_close") public func su_close() { SwiftUsbTransport.shared.close() }

@_cdecl("su_send") public func su_send(
    _ bytes: UnsafePointer<UInt8>, _ length: Int, _ context: UnsafeMutableRawPointer?, _ done: DoneCallback
) {
    SwiftUsbTransport.shared.send(Data(bytes: bytes, count: length), context: context, done: done)
}

@_cdecl("su_receive") public func su_receive(_ maxLength: Int, _ context: UnsafeMutableRawPointer?, _ done: DataCallback) {
    SwiftUsbTransport.shared.receive(maxLength: maxLength, context: context, done: done)
}

@_cdecl("su_reset") public func su_reset() -> Int32 { SwiftUsbTransport.shared.reset() ? 1 : 0 }

@_cdecl("su_events") public func su_events(_ context: UnsafeMutableRawPointer?, _ callback: DataCallback) {
    SwiftUsbTransport.shared.listenForEvents(context: context, callback: callback)
}
