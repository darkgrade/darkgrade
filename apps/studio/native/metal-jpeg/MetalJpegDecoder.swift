// One live-view JPEG decoded entirely on the GPU with Metal, into an IOSurface the display can show as it is.
//
// The camera's frames are one long Huffman stream with no restart markers, so nothing says where a decoder could
// start in the middle. The stream is cut into fixed chunks anyway and every chunk is decoded at once from a guessed
// state; Huffman streams resynchronise within a few symbols, so a chunk's state on leaving is nearly always right
// even when its state on entering was wrong. Each further round re-decodes every chunk from its predecessor's leaving
// state, until a round changes nothing (Weißenberger & Schmidt, "Massively Parallel Huffman Decoding on GPUs", 2018).
// A last pass writes the coefficients that aren't zero, and an inverse transform identical to libjpeg's accurate integer one fills
// the two planes. The CPU only removes the stream's stuffed bytes and submits one command buffer.
//
// Handles what the cameras send: baseline, 8-bit, three components at 4:2:2 (luma 2x1), no restart interval. Anything
// else returns nil and the caller decodes it another way.
import CoreVideo
import Foundation
import Metal

final class MetalJpegDecoder {
    /** Bits of the unstuffed stream each GPU thread decodes. Smaller chunks need more rounds to agree. */
    private static let chunkBits = 1024
    /**
     * Rounds submitted with a frame. The recorded frames needed at most three to agree and one more to count each
     * chunk's blocks from the agreed states; the writing pass checks both, and a frame that fails is resubmitted.
     */
    private static let roundsPerSubmission = 4
    private static let maximumSubmissions = 8
    private static let streamPaddingBytes = 64
    /** Live-view frames are a couple of thousand pixels wide; a larger picture is left to the caller's other decoder. */
    private static let maximumSide = 8192

    private let device: MTLDevice
    private let videoRange: Bool
    private let queue: MTLCommandQueue
    private let synchronisePipeline: MTLComputePipelineState
    private let prefixPipeline: MTLComputePipelineState
    private let emitPipeline: MTLComputePipelineState
    private let transformPipeline: MTLComputePipelineState

    /** The bytes between the image start and the scan, as last parsed: frames from one camera repeat them exactly. */
    private var parsedHeader = [UInt8]()
    private var layout: FrameLayout?
    private var parameters = [UInt32](repeating: 0, count: ParameterIndex.count)

    private var streamBuffer: MTLBuffer?
    private let huffmanBuffer: MTLBuffer
    private let quantisationBuffer: MTLBuffer
    private let statusBuffer: MTLBuffer
    private var exitBuffers: [MTLBuffer] = []
    /** Which of the three holds the states the latest round left; the one before it holds the round before's. */
    private var latestExit = 0
    private var chunkInformationBuffer: MTLBuffer?
    private var chunkBaseBuffer: MTLBuffer?
    private var coefficientBuffer: MTLBuffer?
    private var writtenBuffer: MTLBuffer?
    private var chunkCapacity = 0
    private var blockCapacity = 0

    private var pool: CVPixelBufferPool?
    private var poolSize = (0, 0)
    private var textures: [IOSurfaceID: (luma: MTLTexture, chroma: MTLTexture)] = [:]
    private static let maximumKeptSurfaces = 16

    private struct FrameLayout {
        var width = 0
        var height = 0
        var scanOffset = 0
        var mcuColumns: Int { (width + 15) / 16 }
        var mcuRows: Int { (height + 7) / 8 }
        var blockCount: Int { mcuColumns * mcuRows * 4 }
    }

    /** One output picture: a 4:2:2 two-plane IOSurface and the two textures that write into it. */
    private struct Target {
        let pixelBuffer: CVPixelBuffer
        let luma: MTLTexture
        let chroma: MTLTexture
    }

    /** Where each value sits in the parameter block the shaders read (all 32-bit). */
    private enum ParameterIndex {
        static let chunkCount = 0, totalBits = 1, totalBlocks = 2, mcuColumns = 3
        static let width = 4, height = 5, statesKnown = 6, videoRange = 7
        static let dcTable = 8, acTable = 12, quantisationTable = 16, component = 20
        static let count = 24
    }

    /**
     * `videoRange` squeezes the JPEG's full-range samples into video range (luma 16-235, chroma 16-240) and labels
     * the surface so: the layout Chromium's shared images take. Otherwise the samples stay exactly as decoded.
     */
    init?(device: MTLDevice? = MTLCreateSystemDefaultDevice(), videoRange: Bool = false) {
        guard let device, let queue = device.makeCommandQueue() else { return nil }
        self.device = device
        self.videoRange = videoRange
        parameters[ParameterIndex.videoRange] = videoRange ? 1 : 0
        self.queue = queue
        let options = MTLCompileOptions()
        options.fastMathEnabled = false
        guard let library = try? device.makeLibrary(source: MetalJpegDecoder.shaderSource, options: options) else { return nil }
        func pipeline(_ name: String) -> MTLComputePipelineState? {
            library.makeFunction(name: name).flatMap { try? device.makeComputePipelineState(function: $0) }
        }
        guard let synchronise = pipeline("synchronise"), let prefix = pipeline("prefix"), let emit = pipeline("emit"),
            let transform = pipeline("inverseTransform"),
            let huffman = device.makeBuffer(length: 8 * 65536 * 2, options: .storageModeShared),
            let quantisation = device.makeBuffer(length: 4 * 64 * 2, options: .storageModeShared),
            let status = device.makeBuffer(length: 8, options: .storageModeShared)
        else { return nil }
        synchronisePipeline = synchronise
        prefixPipeline = prefix
        emitPipeline = emit
        transformPipeline = transform
        huffmanBuffer = huffman
        quantisationBuffer = quantisation
        statusBuffer = status
    }

    /**
     * Decodes one frame and waits for it. The bytes are copied before this returns. Returns nil for a JPEG this
     * decoder doesn't handle, or one whose stream is damaged.
     */
    func decode(jpeg: UnsafeRawPointer, count: Int) -> CVPixelBuffer? {
        let bytes = jpeg.assumingMemoryBound(to: UInt8.self)
        guard prepareHeader(bytes, count: count), let layout else { return nil }
        guard let streamBytes = copyStream(bytes, count: count, scanOffset: layout.scanOffset) else { return nil }
        let chunkCount = (streamBytes * 8 + MetalJpegDecoder.chunkBits - 1) / MetalJpegDecoder.chunkBits
        guard chunkCount > 0, prepareBuffers(chunkCount: chunkCount, blockCount: layout.blockCount),
            let target = target(width: layout.width, height: layout.height)
        else { return nil }
        parameters[ParameterIndex.chunkCount] = UInt32(chunkCount)
        parameters[ParameterIndex.totalBits] = UInt32(streamBytes * 8)

        let status = statusBuffer.contents().assumingMemoryBound(to: UInt32.self)
        for submission in 0..<MetalJpegDecoder.maximumSubmissions {
            status[0] = 0
            guard let commandBuffer = queue.makeCommandBuffer(), let encoder = commandBuffer.makeComputeCommandEncoder()
            else { return nil }
            encode(encoder, target: target, layout: layout, chunkCount: chunkCount, continuing: submission > 0)
            encoder.endEncoding()
            commandBuffer.commit()
            commandBuffer.waitUntilCompleted()
            guard commandBuffer.status == .completed else { return nil }
            if status[0] == 0 {
                // Every block must have been found: one more can appear in the padding bits after the last.
                let blocksFound = Int(status[1])
                return blocksFound == layout.blockCount || blocksFound == layout.blockCount + 1 ? target.pixelBuffer : nil
            }
        }
        return nil
    }

    private func encode(
        _ encoder: MTLComputeCommandEncoder, target: Target, layout: FrameLayout, chunkCount: Int, continuing: Bool
    ) {
        let chunkGrid = MTLSize(width: chunkCount, height: 1, depth: 1)
        func threads(_ pipeline: MTLComputePipelineState) -> MTLSize {
            MTLSize(width: pipeline.threadExecutionWidth, height: 1, depth: 1)
        }
        encoder.setBuffer(streamBuffer, offset: 0, index: 0)
        encoder.setBuffer(huffmanBuffer, offset: 0, index: 1)
        encoder.setBuffer(chunkInformationBuffer, offset: 0, index: 5)
        encoder.setBuffer(statusBuffer, offset: 0, index: 6)
        encoder.setBuffer(chunkBaseBuffer, offset: 0, index: 7)
        encoder.setBuffer(coefficientBuffer, offset: 0, index: 8)
        encoder.setBuffer(quantisationBuffer, offset: 0, index: 9)
        encoder.setBuffer(writtenBuffer, offset: 0, index: 10)

        // The rounds rotate through three buffers of leaving states: each reads the two rounds before it and writes
        // the third, so no thread reads what another is writing. A resubmission carries on from where the last ended.
        encoder.setComputePipelineState(synchronisePipeline)
        for round in 0..<MetalJpegDecoder.roundsPerSubmission {
            parameters[ParameterIndex.statesKnown] = continuing || round > 1 ? 2 : UInt32(round)
            encoder.setBytes(parameters, length: parameters.count * 4, index: 2)
            encoder.setBuffer(exitBuffers[latestExit], offset: 0, index: 3)
            encoder.setBuffer(exitBuffers[(latestExit + 1) % 3], offset: 0, index: 4)
            encoder.setBuffer(exitBuffers[(latestExit + 2) % 3], offset: 0, index: 11)
            encoder.dispatchThreads(chunkGrid, threadsPerThreadgroup: threads(synchronisePipeline))
            latestExit = (latestExit + 1) % 3
        }
        let finalExit = exitBuffers[latestExit]

        encoder.setComputePipelineState(prefixPipeline)
        encoder.dispatchThreads(MTLSize(width: 1, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: 1, height: 1, depth: 1))

        encoder.setComputePipelineState(emitPipeline)
        encoder.setBuffer(finalExit, offset: 0, index: 3)
        encoder.dispatchThreads(chunkGrid, threadsPerThreadgroup: threads(emitPipeline))

        encoder.setComputePipelineState(transformPipeline)
        encoder.setTexture(target.luma, index: 0)
        encoder.setTexture(target.chroma, index: 1)
        encoder.dispatchThreads(
            MTLSize(width: layout.blockCount / 4 * 3, height: 1, depth: 1), threadsPerThreadgroup: threads(transformPipeline))
    }

    // MARK: The JPEG's header

    /** Reads the tables and the frame's shape, unless the header is byte for byte the last frame's. */
    private func prepareHeader(_ bytes: UnsafePointer<UInt8>, count: Int) -> Bool {
        guard count > 4, bytes[0] == 0xFF, bytes[1] == 0xD8 else { return false }
        if let layout, layout.scanOffset <= count, memcmp(bytes, parsedHeader, layout.scanOffset) == 0 { return true }
        layout = nil
        guard let parsed = parseHeader(bytes, count: count) else { return false }
        parsedHeader = Array(UnsafeBufferPointer(start: bytes, count: parsed.scanOffset))
        layout = parsed
        parameters[ParameterIndex.totalBlocks] = UInt32(parsed.blockCount)
        parameters[ParameterIndex.mcuColumns] = UInt32(parsed.mcuColumns)
        parameters[ParameterIndex.width] = UInt32(parsed.width)
        parameters[ParameterIndex.height] = UInt32(parsed.height)
        return true
    }

    private func parseHeader(_ bytes: UnsafePointer<UInt8>, count: Int) -> FrameLayout? {
        var layout = FrameLayout()
        var componentIdentifiers = [UInt8]()
        var componentQuantisation = [UInt32]()
        var index = 2
        while index + 4 <= count {
            guard bytes[index] == 0xFF else { return nil }
            let marker = bytes[index + 1]
            let length = Int(bytes[index + 2]) << 8 | Int(bytes[index + 3])
            let body = index + 4
            let end = index + 2 + length
            guard length >= 2, end <= count else { return nil }
            switch marker {
            case 0xDB:
                guard readQuantisationTables(bytes, from: body, to: end) else { return nil }
            case 0xC4:
                guard readHuffmanTables(bytes, from: body, to: end) else { return nil }
            case 0xC0:
                // Eight bits, three components, luma sampled 2x1 and both chroma 1x1: the camera's 4:2:2.
                guard length == 17, bytes[body] == 8, bytes[body + 5] == 3 else { return nil }
                layout.height = Int(bytes[body + 1]) << 8 | Int(bytes[body + 2])
                layout.width = Int(bytes[body + 3]) << 8 | Int(bytes[body + 4])
                guard (1...MetalJpegDecoder.maximumSide).contains(layout.width), (1...MetalJpegDecoder.maximumSide).contains(layout.height)
                else { return nil }
                for component in 0..<3 {
                    let entry = body + 6 + component * 3
                    guard bytes[entry + 1] == (component == 0 ? 0x21 : 0x11), bytes[entry + 2] < 4 else { return nil }
                    componentIdentifiers.append(bytes[entry])
                    componentQuantisation.append(UInt32(bytes[entry + 2]))
                }
            case 0xDD:
                guard length == 4, bytes[body] == 0, bytes[body + 1] == 0 else { return nil }
            case 0xDA:
                // One scan of all three components in frame order, the whole spectrum at once.
                guard componentIdentifiers.count == 3, length == 12, bytes[body] == 3, bytes[body + 7] == 0,
                    bytes[body + 8] == 63, bytes[body + 9] == 0, layout.width > 0, layout.height > 0
                else { return nil }
                for component in 0..<3 {
                    let entry = body + 1 + component * 2
                    let tables = bytes[entry + 1]
                    guard bytes[entry] == componentIdentifiers[component], tables >> 4 < 4, tables & 15 < 4 else { return nil }
                    // Blocks 0 and 1 of a unit are luma, 2 and 3 the two chroma components.
                    for block in component == 0 ? [0, 1] : [component + 1] {
                        parameters[ParameterIndex.dcTable + block] = UInt32(tables >> 4)
                        parameters[ParameterIndex.acTable + block] = UInt32(4 + (tables & 15))
                        parameters[ParameterIndex.quantisationTable + block] = componentQuantisation[component]
                        parameters[ParameterIndex.component + block] = UInt32(component)
                    }
                }
                layout.scanOffset = end
                return layout
            case 0xE0...0xEF, 0xFE:
                break
            default:
                return nil
            }
            index = end
        }
        return nil
    }

    private static let zigzag: [Int] = [
        0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
        28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61,
        54, 47, 55, 62, 63,
    ]

    /** Quantisation tables go to the GPU in the transform's own order, not the stream's zigzag. */
    private func readQuantisationTables(_ bytes: UnsafePointer<UInt8>, from start: Int, to end: Int) -> Bool {
        let tables = quantisationBuffer.contents().assumingMemoryBound(to: UInt16.self)
        var index = start
        while index < end {
            let table = Int(bytes[index] & 15)
            guard bytes[index] >> 4 == 0, table < 4, index + 65 <= end else { return false }
            for position in 0..<64 { tables[table * 64 + MetalJpegDecoder.zigzag[position]] = UInt16(bytes[index + 1 + position]) }
            index += 65
        }
        return true
    }

    /**
     * Each Huffman table becomes 65,536 entries indexed by the stream's next sixteen bits, holding the code's length
     * and its symbol. Bits that begin no code read as a sixteen-bit code, so a thread decoding from a wrong guess
     * still moves on. DC tables fill slots 0-3 and AC tables 4-7.
     */
    private func readHuffmanTables(_ bytes: UnsafePointer<UInt8>, from start: Int, to end: Int) -> Bool {
        let entries = huffmanBuffer.contents().assumingMemoryBound(to: UInt16.self)
        var index = start
        while index < end {
            let slot = Int(bytes[index] >> 4) * 4 + Int(bytes[index] & 15)
            guard bytes[index] >> 4 < 2, bytes[index] & 15 < 4, index + 17 <= end else { return false }
            let symbolCount = (0..<16).reduce(0) { $0 + Int(bytes[index + 1 + $1]) }
            guard index + 17 + symbolCount <= end else { return false }
            let table = entries + slot * 65536
            for entry in 0..<65536 { table[entry] = 16 << 8 }
            var code = 0
            var symbol = index + 17
            for length in 1...16 {
                for _ in 0..<Int(bytes[index + length]) {
                    let first = code << (16 - length)
                    guard first + (1 << (16 - length)) <= 65536 else { return false }
                    let entry = UInt16(length) << 8 | UInt16(bytes[symbol])
                    for offset in 0..<(1 << (16 - length)) { table[first + offset] = entry }
                    code += 1
                    symbol += 1
                }
                code <<= 1
            }
            index += 17 + symbolCount
        }
        return true
    }

    // MARK: The stream

    /**
     * Copies the scan into the GPU's buffer without the zero byte that follows every 0xFF of data, and returns how
     * many bytes that left. The scan ends at the first marker.
     */
    private func copyStream(_ bytes: UnsafePointer<UInt8>, count: Int, scanOffset: Int) -> Int? {
        let needed = count + MetalJpegDecoder.streamPaddingBytes
        if streamBuffer == nil || streamBuffer!.length < needed {
            streamBuffer = device.makeBuffer(length: max(needed * 2, 1 << 20), options: .storageModeShared)
        }
        guard let streamBuffer else { return nil }
        let destination = streamBuffer.contents()
        var written = 0
        var read = scanOffset
        while read < count {
            guard let found = memchr(bytes + read, 0xFF, count - read) else {
                memcpy(destination + written, bytes + read, count - read)
                written += count - read
                break
            }
            let position = bytes.distance(to: found.assumingMemoryBound(to: UInt8.self))
            let stuffed = position + 1 < count && bytes[position + 1] == 0
            let length = position - read + (stuffed ? 1 : 0)
            memcpy(destination + written, bytes + read, length)
            written += length
            guard stuffed else { break }
            read = position + 2
        }
        // Reads run a few bytes past the end of the last symbol.
        memset(destination + written, 0xFF, MetalJpegDecoder.streamPaddingBytes)
        return written > 0 ? written : nil
    }

    // MARK: Buffers and output

    private func prepareBuffers(chunkCount: Int, blockCount: Int) -> Bool {
        if chunkCount > chunkCapacity {
            let capacity = chunkCount * 2
            exitBuffers = (0..<3).compactMap { _ in device.makeBuffer(length: capacity * 4, options: .storageModePrivate) }
            chunkInformationBuffer = device.makeBuffer(length: capacity * 16, options: .storageModePrivate)
            chunkBaseBuffer = device.makeBuffer(length: capacity * 16, options: .storageModePrivate)
            chunkCapacity = exitBuffers.count == 3 && chunkInformationBuffer != nil && chunkBaseBuffer != nil ? capacity : 0
        }
        if blockCount > blockCapacity {
            coefficientBuffer = device.makeBuffer(length: blockCount * 64 * 2, options: .storageModePrivate)
            writtenBuffer = device.makeBuffer(length: blockCount * 8, options: .storageModePrivate)
            blockCapacity = coefficientBuffer != nil && writtenBuffer != nil && clear(writtenBuffer) ? blockCount : 0
        }
        return chunkCount <= chunkCapacity && blockCount <= blockCapacity
    }

    /** The record of written coefficients starts empty; after that the transform empties each block's as it reads it. */
    private func clear(_ buffer: MTLBuffer?) -> Bool {
        guard let buffer, let commandBuffer = queue.makeCommandBuffer(), let encoder = commandBuffer.makeBlitCommandEncoder()
        else { return false }
        encoder.fill(buffer: buffer, range: 0..<buffer.length, value: 0)
        encoder.endEncoding()
        commandBuffer.commit()
        return true
    }

    /**
     * The next picture to write into. The pool hands back a surface once nothing shows or holds it any more, so a few
     * surfaces go round, and the textures made for each are kept: making them costs more than a frame's whole decode.
     */
    private func target(width: Int, height: Int) -> Target? {
        if pool == nil || poolSize != (width, height) {
            let attributes: [CFString: Any] = [
                kCVPixelBufferPixelFormatTypeKey: videoRange
                    ? kCVPixelFormatType_422YpCbCr8BiPlanarVideoRange : kCVPixelFormatType_422YpCbCr8BiPlanarFullRange,
                kCVPixelBufferWidthKey: width, kCVPixelBufferHeightKey: height,
                kCVPixelBufferIOSurfacePropertiesKey: [:] as [String: Any],
                kCVPixelBufferMetalCompatibilityKey: true,
            ]
            pool = nil
            textures = [:]
            CVPixelBufferPoolCreate(nil, nil, attributes as CFDictionary, &pool)
            poolSize = (width, height)
        }
        var made: CVPixelBuffer?
        guard let pool, CVPixelBufferPoolCreatePixelBuffer(nil, pool, &made) == kCVReturnSuccess, let pixelBuffer = made,
            let surface = CVPixelBufferGetIOSurface(pixelBuffer)?.takeUnretainedValue()
        else { return nil }
        CVBufferSetAttachments(pixelBuffer, MetalJpegDecoder.colourAttachments, .shouldPropagate)
        let identifier = IOSurfaceGetID(surface)
        if let kept = textures[identifier] { return Target(pixelBuffer: pixelBuffer, luma: kept.luma, chroma: kept.chroma) }
        func texture(_ format: MTLPixelFormat, plane: Int) -> MTLTexture? {
            let descriptor = MTLTextureDescriptor.texture2DDescriptor(
                pixelFormat: format, width: CVPixelBufferGetWidthOfPlane(pixelBuffer, plane),
                height: CVPixelBufferGetHeightOfPlane(pixelBuffer, plane), mipmapped: false)
            descriptor.usage = [.shaderWrite]
            return device.makeTexture(descriptor: descriptor, iosurface: surface, plane: plane)
        }
        guard let luma = texture(.r8Unorm, plane: 0), let chroma = texture(.rg8Unorm, plane: 1) else { return nil }
        // A pool that keeps growing (a holder that never lets go) must not grow this with it.
        if textures.count >= MetalJpegDecoder.maximumKeptSurfaces { textures = [:] }
        textures[identifier] = (luma, chroma)
        return Target(pixelBuffer: pixelBuffer, luma: luma, chroma: chroma)
    }

    /** A JPEG's colour is full-range BT.601 YCbCr of sRGB. */
    private static let colourAttachments =
        [
            kCVImageBufferYCbCrMatrixKey: kCVImageBufferYCbCrMatrix_ITU_R_601_4,
            kCVImageBufferColorPrimariesKey: kCVImageBufferColorPrimaries_ITU_R_709_2,
            kCVImageBufferTransferFunctionKey: kCVImageBufferTransferFunction_sRGB,
        ] as CFDictionary

    // MARK: Shaders

    private static let shaderSource = """
    #include <metal_stdlib>
    using namespace metal;

    #define CHUNK_BITS \(chunkBits)u

    struct Parameters {
        uint chunkCount;
        uint totalBits;
        uint totalBlocks;
        uint mcuColumns;
        uint width;
        uint height;
        uint statesKnown; // 1: leaving states from the round before exist; 2: and those of the round before that
        uint videoRange;  // write video-range samples instead of the JPEG's full range
        uint dcTable[4]; // per block of a unit: luma, luma, Cb, Cr
        uint acTable[4];
        uint quantisationTable[4];
        uint component[4];
    };

    // What a chunk adds to the running totals: the blocks that begin in it and its DC differences per component.
    struct ChunkTotals {
        int blocks;
        int dc[3];
    };

    constant uchar zigzag[64] = {
        0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
        28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61,
        54, 47, 55, 62, 63};

    static inline uint bigEndian(uint word) {
        return (word >> 24) | ((word >> 8) & 0xFF00u) | ((word << 8) & 0xFF0000u) | (word << 24);
    }

    // The 32 bits of the stream that start at a bit position.
    static inline uint peek(const device uint *stream, uint position) {
        uint index = position >> 5, offset = position & 31u;
        uint high = bigEndian(stream[index]);
        if (offset == 0) return high;
        return (high << offset) | (bigEndian(stream[index + 1]) >> (32u - offset));
    }

    static inline void recordWritten(device atomic_uint *written, uint block, uint2 marks) {
        if (marks.x != 0) atomic_fetch_or_explicit(&written[block * 2u], marks.x, memory_order_relaxed);
        if (marks.y != 0) atomic_fetch_or_explicit(&written[block * 2u + 1u], marks.y, memory_order_relaxed);
    }

    // Decodes the symbols that begin inside one chunk, from the state its predecessor left: how many bits the
    // predecessor's last symbol ran over (5 bits), the block of the unit (2 bits) and the place in that block (6 bits).
    // With `write`, the coefficients that aren't zero go to their blocks, and a bit per coefficient records which were
    // written (two words a block; a block can lie across two chunks, so two threads may add to one record). `base`
    // then says which block comes first and what the DC predictions are on entering.
    static uint decodeChunk(const device uint *stream, const device ushort *tables, constant Parameters &parameters,
                            uint chunk, uint entering, bool write, ChunkTotals base, device short *coefficients,
                            device atomic_uint *written, thread ChunkTotals &totals) {
        uint start = chunk * CHUNK_BITS;
        uint end = min(start + CHUNK_BITS, parameters.totalBits);
        uint position = start + (entering & 31u);
        uint block = (entering >> 5) & 3u;
        uint place = (entering >> 7) & 63u;
        uint current = uint(base.blocks - 1);
        int prediction[3] = {base.dc[0], base.dc[1], base.dc[2]};
        uint2 marks = uint2(0);
        totals.blocks = 0;
        totals.dc[0] = 0; totals.dc[1] = 0; totals.dc[2] = 0;

        while (position < end) {
            uint window = peek(stream, position);
            bool dc = place == 0;
            uint table = dc ? parameters.dcTable[block] : parameters.acTable[block];
            uint entry = tables[table * 65536u + (window >> 16)];
            uint length = entry >> 8, symbol = entry & 255u, size = symbol & 15u;
            int value = 0;
            if (size != 0) {
                uint bits = (window << length) >> (32u - size);
                value = bits < (1u << (size - 1u)) ? int(bits) - int((1u << size) - 1u) : int(bits);
            }
            position += length + size;
            bool inside = write && current + (dc ? 1u : 0u) < parameters.totalBlocks;

            if (dc) {
                uint component = parameters.component[block];
                totals.blocks += 1;
                totals.dc[component] += value;
                if (write && current < parameters.totalBlocks) recordWritten(written, current, marks);
                marks = uint2(1u, 0u);
                current += 1;
                prediction[component] += value;
                if (inside) coefficients[current * 64u] = short(prediction[component]);
                place = 1;
                continue;
            }
            uint run = symbol >> 4;
            uint stop;
            if (size == 0) {
                // Sixteen zeros, or (any other run) the end of the block.
                stop = run == 15u ? min(place + 16u, 64u) : 64u;
            } else {
                stop = min(place + run, 63u);
            }
            if (inside && size != 0) {
                uint index = zigzag[stop];
                coefficients[current * 64u + index] = short(value);
                if (index < 32u) marks.x |= 1u << index; else marks.y |= 1u << (index - 32u);
            }
            place = size == 0 ? stop : stop + 1u;
            if (place >= 64u) {
                place = 0;
                block = (block + 1u) & 3u;
            }
        }
        if (write && current < parameters.totalBlocks) recordWritten(written, current, marks);
        return (position - end) | (block << 5) | (place << 7);
    }

    // One round: every chunk is decoded from the state its predecessor left in the round before (in the first round,
    // from the guess that a block begins exactly at the chunk's first bit).
    kernel void synchronise(const device uint *stream [[buffer(0)]],
                            const device ushort *tables [[buffer(1)]],
                            constant Parameters &parameters [[buffer(2)]],
                            const device uint *previousExit [[buffer(3)]],
                            device uint *nextExit [[buffer(4)]],
                            device ChunkTotals *chunkTotals [[buffer(5)]],
                            const device uint *olderExit [[buffer(11)]],
                            uint chunk [[thread_position_in_grid]]) {
        if (chunk >= parameters.chunkCount) return;
        bool known = parameters.statesKnown != 0;
        uint entering = known && chunk > 0 ? previousExit[chunk - 1] : 0u;
        // A chunk entered in the same state as in the round before leaves as it did then, with the same totals.
        if (parameters.statesKnown == 2u && (chunk == 0 || olderExit[chunk - 1] == entering)) {
            nextExit[chunk] = previousExit[chunk];
            return;
        }
        ChunkTotals none = {0, {0, 0, 0}};
        ChunkTotals totals;
        uint leaving = decodeChunk(stream, tables, parameters, chunk, entering, false, none, nullptr, nullptr, totals);
        nextExit[chunk] = leaving;
        chunkTotals[chunk] = totals;
    }

    // Running totals on entering each chunk: the first block that begins in it and the DC predictions so far.
    kernel void prefix(constant Parameters &parameters [[buffer(2)]],
                       const device ChunkTotals *chunkTotals [[buffer(5)]],
                       device uint *status [[buffer(6)]],
                       device ChunkTotals *chunkBase [[buffer(7)]]) {
        ChunkTotals running = {0, {0, 0, 0}};
        for (uint chunk = 0; chunk < parameters.chunkCount; chunk++) {
            chunkBase[chunk] = running;
            ChunkTotals totals = chunkTotals[chunk];
            running.blocks += totals.blocks;
            running.dc[0] += totals.dc[0];
            running.dc[1] += totals.dc[1];
            running.dc[2] += totals.dc[2];
        }
        status[1] = uint(running.blocks);
    }

    // Writes the coefficients. Decoding a chunk again from its predecessor's state must leave the state and the totals
    // the rounds recorded for it; if any chunk's don't, the rounds hadn't agreed yet and status[0] says so.
    kernel void emit(const device uint *stream [[buffer(0)]],
                     const device ushort *tables [[buffer(1)]],
                     constant Parameters &parameters [[buffer(2)]],
                     const device uint *exits [[buffer(3)]],
                     const device ChunkTotals *chunkTotals [[buffer(5)]],
                     device uint *status [[buffer(6)]],
                     const device ChunkTotals *chunkBase [[buffer(7)]],
                     device short *coefficients [[buffer(8)]],
                     device atomic_uint *written [[buffer(10)]],
                     uint chunk [[thread_position_in_grid]]) {
        if (chunk >= parameters.chunkCount) return;
        ChunkTotals totals;
        uint leaving = decodeChunk(stream, tables, parameters, chunk, chunk > 0 ? exits[chunk - 1] : 0u, true,
                                   chunkBase[chunk], coefficients, written, totals);
        ChunkTotals recorded = chunkTotals[chunk];
        if (leaving != exits[chunk] || totals.blocks != recorded.blocks || totals.dc[0] != recorded.dc[0] ||
            totals.dc[1] != recorded.dc[1] || totals.dc[2] != recorded.dc[2])
            status[0] = 1;
    }

    // libjpeg's accurate integer inverse DCT (jidctint.c, Loeffler-Ligtenberg-Moshovitz), to the same bits.
    #define FIX_0_298631336 2446
    #define FIX_0_390180644 3196
    #define FIX_0_541196100 4433
    #define FIX_0_765366865 6270
    #define FIX_0_899976223 7373
    #define FIX_1_175875602 9633
    #define FIX_1_501321110 12299
    #define FIX_1_847759065 15137
    #define FIX_1_961570560 16069
    #define FIX_2_053119869 16819
    #define FIX_2_562915447 20995
    #define FIX_3_072711026 25172

    static inline void inverseDct1d(thread int *values, int stride, int shift) {
        int z2 = values[2 * stride], z3 = values[6 * stride];
        int z1 = (z2 + z3) * FIX_0_541196100;
        int tmp2 = z1 + z3 * -FIX_1_847759065;
        int tmp3 = z1 + z2 * FIX_0_765366865;
        z2 = values[0];
        z3 = values[4 * stride];
        int tmp0 = (z2 + z3) << 13;
        int tmp1 = (z2 - z3) << 13;
        int tmp10 = tmp0 + tmp3, tmp13 = tmp0 - tmp3, tmp11 = tmp1 + tmp2, tmp12 = tmp1 - tmp2;
        tmp0 = values[7 * stride];
        tmp1 = values[5 * stride];
        tmp2 = values[3 * stride];
        tmp3 = values[1 * stride];
        z1 = tmp0 + tmp3;
        z2 = tmp1 + tmp2;
        z3 = tmp0 + tmp2;
        int z4 = tmp1 + tmp3;
        int z5 = (z3 + z4) * FIX_1_175875602;
        tmp0 *= FIX_0_298631336;
        tmp1 *= FIX_2_053119869;
        tmp2 *= FIX_3_072711026;
        tmp3 *= FIX_1_501321110;
        z1 *= -FIX_0_899976223;
        z2 *= -FIX_2_562915447;
        z3 *= -FIX_1_961570560;
        z4 *= -FIX_0_390180644;
        z3 += z5;
        z4 += z5;
        tmp0 += z1 + z3;
        tmp1 += z2 + z4;
        tmp2 += z2 + z3;
        tmp3 += z1 + z4;
        int rounding = 1 << (shift - 1);
        values[0] = (tmp10 + tmp3 + rounding) >> shift;
        values[7 * stride] = (tmp10 - tmp3 + rounding) >> shift;
        values[1 * stride] = (tmp11 + tmp2 + rounding) >> shift;
        values[6 * stride] = (tmp11 - tmp2 + rounding) >> shift;
        values[2 * stride] = (tmp12 + tmp1 + rounding) >> shift;
        values[5 * stride] = (tmp12 - tmp1 + rounding) >> shift;
        values[3 * stride] = (tmp13 + tmp0 + rounding) >> shift;
        values[4 * stride] = (tmp13 - tmp0 + rounding) >> shift;
    }

    // Reads the coefficients the record says were written (the rest are zero, whatever an earlier frame left there)
    // and empties the record for the next frame.
    static void inverseDct(const device short *coefficients, device atomic_uint *written,
                           const device ushort *quantisation, thread int *samples) {
        uint low = atomic_exchange_explicit(&written[0], 0u, memory_order_relaxed);
        uint high = atomic_exchange_explicit(&written[1], 0u, memory_order_relaxed);
        for (uint index = 0; index < 64; index++) {
            bool present = ((index < 32u ? low >> index : high >> (index - 32u)) & 1u) != 0;
            samples[index] = present ? int(coefficients[index]) * int(quantisation[index]) : 0;
        }
        for (uint column = 0; column < 8; column++) inverseDct1d(samples + column, 8, 11);
        for (uint row = 0; row < 8; row++) inverseDct1d(samples + row * 8, 1, 18);
        for (uint index = 0; index < 64; index++) samples[index] = clamp(samples[index] + 128, 0, 255);
    }

    // Full range to video range, rounded to nearest: luma 0-255 to 16-235, chroma 0-255 about 128 to 16-240.
    static void toVideoRange(thread int *samples, bool chroma) {
        for (uint index = 0; index < 64; index++) {
            int value = samples[index];
            if (chroma) {
                int centred = (value - 128) * 224;
                samples[index] = (centred + (centred >= 0 ? 127 : -127)) / 255 + 128;
            } else {
                samples[index] = (value * 219 + 127) / 255 + 16;
            }
        }
    }

    // Three threads a unit: its two luma blocks, and its Cb and Cr blocks together (they share a texel).
    kernel void inverseTransform(constant Parameters &parameters [[buffer(2)]],
                                 const device short *coefficients [[buffer(8)]],
                                 const device ushort *quantisation [[buffer(9)]],
                                 device atomic_uint *written [[buffer(10)]],
                                 texture2d<float, access::write> luma [[texture(0)]],
                                 texture2d<float, access::write> chroma [[texture(1)]],
                                 uint index [[thread_position_in_grid]]) {
        uint unit = index / 3u, part = index % 3u;
        if (unit * 4u >= parameters.totalBlocks) return;
        uint left = (unit % parameters.mcuColumns) * 16u, top = (unit / parameters.mcuColumns) * 8u;
        int first[64];
        if (part < 2u) {
            uint block = unit * 4u + part;
            inverseDct(coefficients + block * 64u, written + block * 2u,
                       quantisation + parameters.quantisationTable[part] * 64u, first);
            if (parameters.videoRange != 0) toVideoRange(first, false);
            left += part * 8u;
            for (uint row = 0; row < 8; row++) {
                for (uint column = 0; column < 8; column++) {
                    uint2 at = uint2(left + column, top + row);
                    if (at.x < parameters.width && at.y < parameters.height)
                        luma.write(float4(float(first[row * 8 + column]) / 255.0f, 0, 0, 1), at);
                }
            }
            return;
        }
        int second[64];
        uint blue = unit * 4u + 2u, red = unit * 4u + 3u;
        inverseDct(coefficients + blue * 64u, written + blue * 2u, quantisation + parameters.quantisationTable[2] * 64u, first);
        inverseDct(coefficients + red * 64u, written + red * 2u, quantisation + parameters.quantisationTable[3] * 64u, second);
        if (parameters.videoRange != 0) {
            toVideoRange(first, true);
            toVideoRange(second, true);
        }
        left /= 2u;
        uint chromaWidth = (parameters.width + 1u) / 2u;
        for (uint row = 0; row < 8; row++) {
            for (uint column = 0; column < 8; column++) {
                uint2 at = uint2(left + column, top + row);
                if (at.x < chromaWidth && at.y < parameters.height)
                    chroma.write(float4(float(first[row * 8 + column]) / 255.0f, float(second[row * 8 + column]) / 255.0f, 0, 1), at);
            }
        }
    }
    """
}
