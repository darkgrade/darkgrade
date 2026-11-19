// Node-API glue for the Metal JPEG decoder (MetalJpegDecoder.swift).
//
// decode(jpeg: Uint8Array) → Promise of { surface: Buffer holding the IOSurfaceRef, width, height }, or null where the
// frame can't be decoded here. The decode runs on a worker thread; the main thread never waits for the GPU. The last
// few pictures are kept alive here; Electron retains the surface it imports for as long as it needs it.
#include <CoreVideo/CoreVideo.h>
#include <node_api.h>
#include <stdlib.h>

void *metal_jpeg_decode(const void *jpeg, size_t count);

#define KEPT_PICTURES 8
static CVPixelBufferRef kept[KEPT_PICTURES];
static int keptIndex = 0;

typedef struct {
    napi_async_work work;
    napi_deferred deferred;
    napi_ref jpegReference;
    void *bytes;
    size_t length;
    CVPixelBufferRef decoded;
} Decode;

/** On a worker thread: no Node-API calls here. */
static void Execute(napi_env env, void *data) {
    Decode *decode = data;
    decode->decoded = metal_jpeg_decode(decode->bytes, decode->length);
}

static void Complete(napi_env env, napi_status status, void *data) {
    Decode *decode = data;
    napi_value result;
    IOSurfaceRef surface = decode->decoded ? CVPixelBufferGetIOSurface(decode->decoded) : NULL;
    if (surface) {
        if (kept[keptIndex]) CVPixelBufferRelease(kept[keptIndex]);
        kept[keptIndex] = decode->decoded;
        keptIndex = (keptIndex + 1) % KEPT_PICTURES;
        napi_value handle, width, height;
        napi_create_object(env, &result);
        napi_create_buffer_copy(env, sizeof(surface), &surface, NULL, &handle);
        napi_create_uint32(env, (uint32_t)CVPixelBufferGetWidth(decode->decoded), &width);
        napi_create_uint32(env, (uint32_t)CVPixelBufferGetHeight(decode->decoded), &height);
        napi_set_named_property(env, result, "surface", handle);
        napi_set_named_property(env, result, "width", width);
        napi_set_named_property(env, result, "height", height);
    } else {
        if (decode->decoded) CVPixelBufferRelease(decode->decoded);
        napi_get_null(env, &result);
    }
    napi_resolve_deferred(env, decode->deferred, result);
    napi_delete_reference(env, decode->jpegReference);
    napi_delete_async_work(env, decode->work);
    free(decode);
}

static napi_value DecodeJpeg(napi_env env, napi_callback_info info) {
    size_t count = 1;
    napi_value argument, promise, name;
    napi_get_cb_info(env, info, &count, &argument, NULL, NULL);
    Decode *decode = calloc(1, sizeof(Decode));
    napi_create_promise(env, &decode->deferred, &promise);
    bool isTypedArray = false;
    if (count >= 1) napi_is_typedarray(env, argument, &isTypedArray);
    if (isTypedArray) {
        napi_typedarray_type type;
        napi_value arrayBuffer;
        size_t offset;
        napi_get_typedarray_info(env, argument, &type, &decode->length, &decode->bytes, &arrayBuffer, &offset);
    }
    if (!decode->bytes || !decode->length) {
        napi_value nothing;
        napi_get_null(env, &nothing);
        napi_resolve_deferred(env, decode->deferred, nothing);
        free(decode);
        return promise;
    }
    // The JPEG's bytes stay alive (a reference) until the worker is done with them; no copy.
    napi_create_reference(env, argument, 1, &decode->jpegReference);
    napi_create_string_utf8(env, "metal-jpeg", NAPI_AUTO_LENGTH, &name);
    napi_create_async_work(env, NULL, name, Execute, Complete, decode, &decode->work);
    napi_queue_async_work(env, decode->work);
    return promise;
}

static napi_value Init(napi_env env, napi_value exports) {
    napi_value decode;
    napi_create_function(env, "decode", NAPI_AUTO_LENGTH, DecodeJpeg, NULL, &decode);
    napi_set_named_property(env, exports, "decode", decode);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
