// What the Node add-on (addon.c) calls: one decoder for the process, used by one thread at a time.
import CoreVideo
import Foundation

/** Video range: the only 4:2:2 layout Chromium's shared images accept from an IOSurface. */
private let decoder = MetalJpegDecoder(videoRange: true)
private let decoderLock = NSLock()

/**
 * Decodes a live-view JPEG on the GPU. Returns a retained CVPixelBuffer (the caller releases it) backed by an
 * IOSurface, or nil where there is no Metal device or the decoder doesn't handle this JPEG.
 */
@_cdecl("metal_jpeg_decode")
public func metalJpegDecode(_ jpeg: UnsafeRawPointer, _ count: Int) -> UnsafeMutableRawPointer? {
    decoderLock.lock()
    defer { decoderLock.unlock() }
    guard let image = decoder?.decode(jpeg: jpeg, count: count) else { return nil }
    return Unmanaged.passRetained(image).toOpaque()
}
