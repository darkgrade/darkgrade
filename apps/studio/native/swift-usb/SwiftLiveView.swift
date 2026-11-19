// EXPERIMENT(usb-transport): Developer Mode's "Swift live-view loop". Live view fetched on a thread of its own,
// between Link's transactions on SwiftUsbTransport's pipes: one PTP transaction a frame, asked for when the camera's
// frame is due, read straight into a kept buffer and decoded on the GPU from that buffer (MetalJpegDecoder). The
// decoded surface, or the JPEG when GPU decoding is off or fails, goes to JavaScript once a frame. Sony bodies only.
// Removing the "USB Transport" choice removes this file with the rest of native/swift-usb.
import CoreVideo
import Foundation

/**
 * Called on the live thread or the picture queue. `kind` 0: the loop stopped on an error. 1: a frame decoded on the
 * GPU (a retained CVPixelBuffer the receiver releases, and its size). 2: a frame as its JPEG. The camera's focus
 * frames come with both.
 */
public typealias FrameCallback = @convention(c) (
    UnsafeMutableRawPointer?, Int32, UnsafeMutableRawPointer?, Int32, Int32, UnsafePointer<UInt8>?, Int,
    UnsafePointer<UInt8>?, Int
) -> Void

private var timebaseInfo: mach_timebase_info_data_t = {
    var info = mach_timebase_info_data_t()
    mach_timebase_info(&info)
    return info
}()

/** A reply Link never collects (it timed out) stops holding live view back after this long. */
private let transactionHoldSeconds = 5.0
private let getObject: UInt16 = 0x1009
private let responseOK: UInt16 = 0x2001
private let sonyAccessDenied: UInt16 = 0x200F
private let sonyLiveViewHandle: UInt32 = 0xFFFF_C002
/** Between "not ready" answers. */
private let retrySeconds = 0.001
/** Requests polled a millisecond apart to find the camera's tick before following it. */
private let ticksToMeasure = 12
/** How much earlier than the last each request goes once the tick interval is measured. */
private let fineCreepSeconds = 0.00001
/** After a request creeps past its tick and is refused, the following ones are sent this long after the tick. */
private let marginAfterTickSeconds = 0.0005
/** Once the tick is followed, more refusals than this for one frame mean the camera's clock changed: find it again. */
private let refusalsBeforeMeasuringAgain = 4

/**
 * Follows the camera's own 30-a-second clock. The camera accepts one frame request per tick, refuses any other ("not
 * ready", three transfers each), and holds an accepted request until its frame is ready, so the cheapest schedule is
 * one request sent just after each tick. Polling every millisecond, as before, was refused several times a frame.
 *
 * The tick is found by polling for a dozen frames. After that each request goes a little earlier than the last
 * (the creep) until one lands before its tick and is refused: that moment marks the tick to within the creep, the
 * retry a millisecond later is accepted, and two such marks far apart give the tick interval to a few microseconds.
 * The creep starts coarse, to outrun the error in the polled estimate, and turns fine once marks have measured the
 * interval: then about one request in fifty is refused and a request is sent within half a millisecond of its tick.
 */
private struct FrameClock {
    private var polled: [Double] = []
    /** The tick interval as polling found it: good to a few tenths of a millisecond. */
    private var polledPeriod: Double?
    private var period: Double?
    /** When the request for the latest tick was due: the schedule, which a request sent late doesn't move. */
    private var due: (tick: Int, time: Double)?
    /** Requests refused just before their tick, while following it. */
    private var marks: [(tick: Int, time: Double)] = []
    private var refusedThisTick: Double?
    /** Whether each of the last frames was refused at least once, newest last. */
    private var recentRefusals: [Bool] = []
    private var framesSinceRefusal = 0

    var following: Bool { period != nil }

    /** Too many refused frames while following: the estimate is wrong or the camera's clock changed. */
    var lost: Bool { recentRefusals.count >= 16 && recentRefusals.filter { $0 }.count >= 8 }

    var description: String {
        String(format: "tick %.4f ms, %d marks, creep %.0f us", (period ?? 0) * 1000, marks.count, creep * 1e6)
    }

    private var measured: Bool { period != polledPeriod }

    /**
     * Coarse until marks have measured the interval, to outrun the error in the polled estimate, and again whenever no
     * request has been refused for five seconds: then the estimate is a little long and the requests are sliding late.
     */
    private var creep: Double {
        if measured && framesSinceRefusal < 150 { return fineCreepSeconds }
        // Still no refusal after another five seconds: the estimate is further out than the creep covers, so it doubles.
        return 0.0005 * pow(2, Double(min(6, framesSinceRefusal / 150)))
    }

    /** When to send the next request; nil while the tick is still being found (then: ask now, and retry). */
    var nextRequest: Double? {
        guard let period, let due else { return nil }
        return due.time + period - creep
    }

    mutating func reset() { self = FrameClock() }

    /**
     * The tick interval from the polled requests. Some are more than one tick apart (Link's own commands took the
     * pipe in between), so the ticks between each pair are counted against the shortest spacings before averaging;
     * taking every spacing for one tick put the interval at 38.8 ms for a 33.4 ms camera, which lost four frames a second.
     */
    private func polledInterval() -> Double? {
        let spacings = zip(polled.dropFirst(), polled).map { $0 - $1 }
        guard let shortest = spacings.min(), let first = polled.first, let last = polled.last else { return nil }
        let single = spacings.filter { $0 < shortest * 1.4 }.sorted()
        let one = single[single.count / 2]
        let ticks = spacings.reduce(0) { $0 + max(1, Int(($1 / one).rounded())) }
        return (last - first) / Double(ticks)
    }

    mutating func requestRefused(at time: Double) {
        guard let period, let polledPeriod, let due, refusedThisTick == nil else { return }
        refusedThisTick = time
        // A mark is the request that crept past its tick: the first one refused, one interval after the last one due.
        let ticks = (time - due.time) / period
        guard ticks > 0.5, ticks < 1.5, recentRefusals.last != true else { return }
        marks.append((due.tick + 1, time))
        if marks.count > 16 { marks.removeFirst() }
        guard let first = marks.first, let last = marks.last, last.tick - first.tick >= 30 else { return }
        let interval = (last.time - first.time) / Double(last.tick - first.tick)
        if abs(interval - polledPeriod) < 0.0005 {
            self.period = interval
        } else {
            marks = []
        }
    }

    /** `scheduled` is when the request was meant to go; `sent` when it went (later, if the thread was held up). */
    mutating func requestAccepted(scheduled: Double, sent: Double) {
        guard let period, let due else {
            polled.append(sent)
            if polled.count >= ticksToMeasure, let interval = polledInterval() {
                polledPeriod = interval
                self.period = interval
                self.due = (0, sent)
            }
            return
        }
        let ticks = max(1, Int(((sent - due.time) / period).rounded()))
        if let refused = refusedThisTick {
            // The tick came just after the refused request when that one had only crept past it; otherwise all that
            // is known is that it came before the retry that was accepted.
            let creptPast = measured && recentRefusals.last != true && marks.last?.time == refused
            self.due = (due.tick + ticks, creptPast ? refused + marginAfterTickSeconds : sent)
        } else {
            self.due = (due.tick + ticks, scheduled + Double(ticks - 1) * period)
        }
        recentRefusals.append(refusedThisTick != nil)
        if recentRefusals.count > 16 { recentRefusals.removeFirst() }
        framesSinceRefusal = refusedThisTick != nil ? 0 : framesSinceRefusal + 1
        refusedThisTick = nil
    }
}

final class SwiftLiveView {
    static let shared = SwiftLiveView()

    struct Statistics {
        var frames = 0
        var requests = 0
        var refusals = 0
        /** Frames identical to the one before: the camera repeats one when its sensor runs slower than its ticks. */
        var repeated = 0
        /** Frames that reached JavaScript as a decoded surface. */
        var decoded = 0
    }

    /** Guards the statistics, the newest JPEG and the running flags. */
    private let state = NSCondition()
    private var counters = Statistics()
    private var latestJpeg = NSMutableData()
    private var live = false
    private var running = false
    private var decodeOnGpu = true

    /** Video range: the only 4:2:2 layout Chromium's shared images accept from an IOSurface. */
    private let decoder = MetalJpegDecoder(videoRange: true)
    /** Decoding, in order, off the thread that talks to the camera. */
    private let pictureQueue = DispatchQueue(label: "studio.swift-live-view.picture", qos: .userInteractive)

    var statistics: Statistics {
        state.lock()
        defer { state.unlock() }
        return counters
    }

    func withLatestJpeg(_ body: (UnsafePointer<UInt8>?, Int) -> Void) {
        state.lock()
        defer { state.unlock() }
        body(latestJpeg.length > 0 ? latestJpeg.bytes.assumingMemoryBound(to: UInt8.self) : nil, latestJpeg.length)
    }

    func start(usb: SwiftUsbTransport, decodeOnGpu: Bool, context: UnsafeMutableRawPointer?, callback: FrameCallback) {
        stop()
        // The transport closes its pipes only after this loop has finished the transaction it is in.
        usb.beforeClose = { [weak self] in self?.stop() }
        state.lock()
        live = true
        running = true
        self.decodeOnGpu = decodeOnGpu
        counters = Statistics()
        state.unlock()
        let thread = Thread { [self] in
            wakeOnTime()
            run(usb: usb, context: context, callback: callback)
            state.lock()
            running = false
            state.broadcast()
            state.unlock()
        }
        thread.name = "studio.swift-live-view"
        thread.qualityOfService = .userInteractive
        thread.start()
    }

    /**
     * Asks the scheduler to wake this thread when its sleeps end rather than when convenient. An ordinary thread's
     * timers are coalesced: measured here, it woke 1.3 to 2.5 ms late on average and up to 6 ms, which sent every
     * request late and cost three or four frames a second. The thread sleeps or waits on the camera nearly all the
     * time (about half a millisecond of work a frame), which is what this scheduling class is for.
     */
    private func wakeOnTime() {
        let ticks = { (seconds: Double) in UInt32(seconds * 1e9 * Double(timebaseInfo.denom) / Double(timebaseInfo.numer)) }
        var policy = thread_time_constraint_policy_data_t(
            period: ticks(1.0 / 30), computation: ticks(0.0005), constraint: ticks(0.002), preemptible: 1)
        let count = mach_msg_type_number_t(
            MemoryLayout<thread_time_constraint_policy_data_t>.size / MemoryLayout<integer_t>.size)
        withUnsafeMutablePointer(to: &policy) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { values in
                _ = thread_policy_set(
                    pthread_mach_thread_np(pthread_self()), thread_policy_flavor_t(THREAD_TIME_CONSTRAINT_POLICY), values,
                    count)
            }
        }
    }

    /** Stops after the transaction in progress, so the camera isn't left with a reply nobody reads. */
    func stop() {
        state.lock()
        live = false
        let deadline = Date(timeIntervalSinceNow: 1)
        while running, state.wait(until: deadline) {}
        state.unlock()
    }

    private var isLive: Bool {
        state.lock()
        defer { state.unlock() }
        return live
    }

    private enum Outcome {
        /** A frame's data container is in the frame buffer, this many bytes long. */
        case frame(Int)
        case refused
        case failed
    }

    private func run(usb: SwiftUsbTransport, context: UnsafeMutableRawPointer?, callback: FrameCallback) {
        var clock = FrameClock()
        var transactionId: UInt32 = 0x7F00_0000
        let request = NSMutableData(length: 16)!
        let frameBuffers = FrameBuffers()
        let responseBuffer = NSMutableData(length: 1024)!
        var lastFocal = Data()
        var nextRequest = now()
        var refusalsThisFrame = 0
        var framesSeen = 0

        while isLive {
            if nextRequest > now() { sleep(until: nextRequest) }
            usb.pipes.lock()
            while let since = usb.transactionOpenSince, now() - since < transactionHoldSeconds, isLive {
                usb.pipes.wait(until: Date(timeIntervalSinceNow: 0.05))
            }
            guard isLive else {
                usb.pipes.unlock()
                break
            }
            usb.transactionOpenSince = nil
            transactionId &+= 1
            let asked = now()
            let frameBuffer = frameBuffers.free()
            let outcome = transact(usb: usb, id: transactionId, request: request, frame: frameBuffer, response: responseBuffer)
            usb.pipes.unlock()

            state.lock()
            counters.requests += 1
            state.unlock()
            switch outcome {
            case .failed:
                state.lock()
                live = false
                state.unlock()
                callback(context, 0, nil, 0, 0, nil, 0, nil, 0)
            case .refused:
                state.lock()
                counters.refusals += 1
                state.unlock()
                refusalsThisFrame += 1
                clock.requestRefused(at: asked)
                if clock.following, refusalsThisFrame > refusalsBeforeMeasuringAgain || clock.lost { clock.reset() }
                nextRequest = now() + retrySeconds
            case .frame(let length):
                framesSeen += 1
                refusalsThisFrame = 0
                clock.requestAccepted(scheduled: nextRequest, sent: asked)
                nextRequest = clock.nextRequest ?? now()
                deliver(
                    frame: frameBuffer, count: length, buffers: frameBuffers, lastFocal: &lastFocal, context: context,
                    callback: callback)
            }
        }
    }

    /** One GetObject for the live-view handle (call with the pipes held). The data container lands in `frame`. */
    private func transact(usb: SwiftUsbTransport, id: UInt32, request: NSMutableData, frame: NSMutableData, response: NSMutableData)
        -> Outcome
    {
        let command = request.mutableBytes
        command.storeBytes(of: UInt32(16), toByteOffset: 0, as: UInt32.self)
        command.storeBytes(of: containerCommand, toByteOffset: 4, as: UInt16.self)
        command.storeBytes(of: getObject, toByteOffset: 6, as: UInt16.self)
        command.storeBytes(of: id, toByteOffset: 8, as: UInt32.self)
        command.storeBytes(of: sonyLiveViewHandle, toByteOffset: 12, as: UInt32.self)
        guard usb.write(buffer: request) else { return failed("the request could not be sent") }

        var received = 0
        repeat {
            guard let length = usb.read(into: frame) else { return failed("the reply could not be read") }
            received = length
        } while received == 0
        guard received >= 12 else { return failed("a reply of \(received) bytes") }
        let declared = Int(frame.bytes.load(fromByteOffset: 0, as: UInt32.self))
        let kind = frame.bytes.load(fromByteOffset: 4, as: UInt16.self)
        if kind == containerResponse {
            let code = frame.bytes.load(fromByteOffset: 6, as: UInt16.self)
            return code == sonyAccessDenied ? .refused : failed("response 0x\(String(code, radix: 16)) with no frame")
        }
        guard kind == containerData, declared >= 12, declared <= 64 << 20 else {
            return failed("container type \(kind) declaring \(declared) bytes")
        }
        if declared > received {
            guard readRest(usb: usb, of: frame, received: received, declared: declared) else {
                return failed("the rest of a \(declared)-byte frame could not be read")
            }
        }

        var responseLength = 0
        repeat {
            guard let length = usb.read(into: response) else { return failed("the response could not be read") }
            responseLength = length
        } while responseLength == 0
        guard responseLength >= 12, response.bytes.load(fromByteOffset: 4, as: UInt16.self) == containerResponse else {
            return failed("no response followed the frame")
        }
        // "Not ready" can also come after a data phase (a 512-byte placeholder).
        let code = response.bytes.load(fromByteOffset: 6, as: UInt16.self)
        if code == sonyAccessDenied { return .refused }
        guard code == responseOK else { return failed("response 0x\(String(code, radix: 16)) after a frame") }
        return .frame(declared)
    }

    private func failed(_ reason: String) -> Outcome {
        FileHandle.standardError.write("swift live view stopped: \(reason)\n".data(using: .utf8)!)
        return .failed
    }

    /**
     * A frame larger than the buffer it was read into: the buffer grows to twice the frame, so the following ones
     * arrive in one transfer, and the rest of this one is read behind what already arrived.
     */
    private func readRest(usb: SwiftUsbTransport, of frame: NSMutableData, received: Int, declared: Int) -> Bool {
        frame.length = ((declared * 2) / (64 << 10) + 1) * (64 << 10)
        let rest = NSMutableData(length: frame.length)!
        var total = received
        while total < declared {
            guard let length = usb.read(into: rest) else { return false }
            guard total + length <= frame.length else { return false }
            memcpy(frame.mutableBytes + total, rest.bytes, length)
            total += length
        }
        return true
    }

    /**
     * Sony's live-view dataset, after the container's 12-byte header: offsets and sizes of the JPEG and the focus
     * frames, then the data. The frame is decoded on the picture queue, from the buffer it arrived in.
     */
    private func deliver(
        frame: NSMutableData, count: Int, buffers: FrameBuffers, lastFocal: inout Data, context: UnsafeMutableRawPointer?,
        callback: FrameCallback
    ) {
        let dataset = UnsafeRawPointer(frame.bytes) + 12
        let datasetCount = count - 12
        guard datasetCount >= 16 else { return }
        let field = { (offset: Int) in Int(dataset.loadUnaligned(fromByteOffset: offset, as: UInt32.self)) }
        let (imageOffset, imageSize, focalOffset, focalSize) = (field(0), field(4), field(8), field(12))
        guard imageOffset > 0, imageSize > 0, imageOffset + imageSize <= datasetCount else { return }
        let jpeg = dataset + imageOffset

        state.lock()
        counters.frames += 1
        let repeated = latestJpeg.length == imageSize && memcmp(latestJpeg.bytes, jpeg, imageSize) == 0
        if repeated { counters.repeated += 1 }
        latestJpeg.length = imageSize
        memcpy(latestJpeg.mutableBytes, jpeg, imageSize)
        let onGpu = decodeOnGpu
        state.unlock()

        // A repeated frame is already on screen: nothing to decode or send.
        guard !repeated else { return }
        let focal = focalOffset > 0 && focalSize > 0 && focalOffset + focalSize <= datasetCount
            ? Data(bytes: dataset + focalOffset, count: focalSize) : Data()
        lastFocal = focal
        buffers.hold(frame)
        pictureQueue.async { [self] in
            defer { buffers.release(frame) }
            let image = onGpu ? decoder?.decode(jpeg: jpeg, count: imageSize) : nil
            focal.withUnsafeBytes { focalBytes in
                let focalPointer = focalBytes.bindMemory(to: UInt8.self).baseAddress
                guard let image else {
                    return callback(
                        context, 2, nil, 0, 0, jpeg.assumingMemoryBound(to: UInt8.self), imageSize, focalPointer, focal.count)
                }
                state.lock()
                counters.decoded += 1
                state.unlock()
                callback(
                    context, 1, Unmanaged.passRetained(image).toOpaque(), Int32(CVPixelBufferGetWidth(image)),
                    Int32(CVPixelBufferGetHeight(image)), nil, 0, focalPointer, focal.count)
            }
        }
    }
}

/**
 * The buffers frames are read into. The decoder reads a frame where it arrived, so that buffer is held until the
 * decode is done and the next frame goes into another: the request for it is never kept waiting for the decoder
 * (waiting made requests late and lost about two frames a second).
 */
private final class FrameBuffers {
    private let lock = NSLock()
    private var buffers: [NSMutableData] = []
    private var held = Set<ObjectIdentifier>()

    /**
     * A buffer nothing is reading. Each read asks the kernel to map the whole buffer, so it is no larger than a frame
     * needs: reading into 4 MB cost twice the CPU of reading into 512 KB.
     */
    func free() -> NSMutableData {
        lock.lock()
        defer { lock.unlock() }
        if let buffer = buffers.first(where: { !held.contains(ObjectIdentifier($0)) }) { return buffer }
        let buffer = NSMutableData(length: buffers.first?.length ?? 512 << 10)!
        buffers.append(buffer)
        return buffer
    }

    func hold(_ buffer: NSMutableData) {
        lock.lock()
        held.insert(ObjectIdentifier(buffer))
        lock.unlock()
    }

    func release(_ buffer: NSMutableData) {
        lock.lock()
        held.remove(ObjectIdentifier(buffer))
        lock.unlock()
    }
}

// MARK: C entry points for the Node-API glue (addon.c)

@_cdecl("su_live_start") public func su_live_start(
    _ decodeOnGpu: Int32, _ context: UnsafeMutableRawPointer?, _ callback: FrameCallback
) {
    SwiftLiveView.shared.start(usb: SwiftUsbTransport.shared, decodeOnGpu: decodeOnGpu != 0, context: context, callback: callback)
}

@_cdecl("su_live_stop") public func su_live_stop() { SwiftLiveView.shared.stop() }

/** Writes frames, requests, refused requests, repeated frames and frames decoded on the GPU. */
@_cdecl("su_live_statistics") public func su_live_statistics(_ out: UnsafeMutablePointer<Int64>) {
    let statistics = SwiftLiveView.shared.statistics
    out[0] = Int64(statistics.frames)
    out[1] = Int64(statistics.requests)
    out[2] = Int64(statistics.refusals)
    out[3] = Int64(statistics.repeated)
    out[4] = Int64(statistics.decoded)
}

/** The newest frame's JPEG, copied for the caller (Studio's tools look at it on demand). */
@_cdecl("su_live_latest_jpeg") public func su_live_latest_jpeg(_ context: UnsafeMutableRawPointer?, _ done: DataCallback) {
    SwiftLiveView.shared.withLatestJpeg { bytes, count in done(context, 0, bytes, count) }
}
