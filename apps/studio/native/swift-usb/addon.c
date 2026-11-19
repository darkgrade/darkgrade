// EXPERIMENT(usb-transport): Node-API glue for SwiftUsbTransport.swift and SwiftLiveView.swift. Swift calls back on
// its own threads; each result is copied and handed to the JavaScript thread through a thread-safe function, where
// it resolves a promise or calls a listener. Removed with the rest of native/swift-usb.
//
// Transport:  open(vendorId, productId) → boolean   close()   reset() → boolean
//             send(bytes) → Promise<void>           receive(maxLength) → Promise<Uint8Array>
//             onEvent((bytes) => void)
// Live view:  startLiveView(decodeOnGpu, (frame | null) => void)   stopLiveView()
//             liveStatistics() → { frames, requests, refusals, repeated, decoded }   latestJpeg() → Uint8Array | null
// A frame is { surface, width, height, jpeg, focal }: `surface` holds the IOSurfaceRef of a frame decoded on the GPU
// (else it is empty and `jpeg` holds the frame); `focal` is the camera's focus frames. null: the loop stopped on an
// error.
#include <CoreVideo/CoreVideo.h>
#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef void (*su_done_cb)(void *, int32_t);
typedef void (*su_data_cb)(void *, int32_t, const uint8_t *, size_t);
typedef void (*su_frame_cb)(void *, int32_t, void *, int32_t, int32_t, const uint8_t *, size_t, const uint8_t *, size_t);

extern int32_t su_open(int32_t vendor, int32_t product);
extern void su_close(void);
extern void su_send(const uint8_t *bytes, size_t length, void *context, su_done_cb done);
extern void su_receive(size_t max_length, void *context, su_data_cb done);
extern int32_t su_reset(void);
extern void su_events(void *context, su_data_cb callback);
extern void su_live_start(int32_t decode_on_gpu, void *context, su_frame_cb callback);
extern void su_live_stop(void);
extern void su_live_statistics(int64_t *out);
extern void su_live_latest_jpeg(void *context, su_data_cb done);

/** A copied byte range; null data with length 0 is allowed. */
typedef struct {
    uint8_t *data;
    size_t length;
} Bytes;

static Bytes copy_bytes(const uint8_t *data, size_t length) {
    Bytes bytes = {NULL, length};
    if (data && length) {
        bytes.data = malloc(length);
        memcpy(bytes.data, data, length);
    }
    return bytes;
}

static napi_value to_buffer(napi_env env, Bytes bytes) {
    napi_value buffer;
    napi_create_buffer_copy(env, bytes.length, bytes.data ? (void *)bytes.data : (void *)"", NULL, &buffer);
    free(bytes.data);
    return buffer;
}

// One thread-safe function settles every send and receive promise.
static napi_threadsafe_function completions = NULL;

typedef struct {
    napi_deferred deferred;
    int32_t status;
    int has_data;
    Bytes data;
} Completion;

static void settle(napi_env env, napi_value js_callback, void *context, void *data) {
    Completion *completion = data;
    if (env) {
        if (completion->status != 0) {
            napi_value message, error;
            napi_create_string_utf8(env, "Swift USB transfer failed", NAPI_AUTO_LENGTH, &message);
            napi_create_error(env, NULL, message, &error);
            napi_reject_deferred(env, completion->deferred, error);
            free(completion->data.data);
        } else {
            napi_value result;
            if (completion->has_data)
                result = to_buffer(env, completion->data);
            else
                napi_get_undefined(env, &result);
            napi_resolve_deferred(env, completion->deferred, result);
        }
    }
    free(completion);
}

static void on_done(void *context, int32_t status) {
    Completion *completion = context;
    completion->status = status;
    napi_call_threadsafe_function(completions, completion, napi_tsfn_blocking);
}

static void on_data(void *context, int32_t status, const uint8_t *data, size_t length) {
    Completion *completion = context;
    completion->status = status;
    completion->has_data = 1;
    completion->data = copy_bytes(data, length);
    napi_call_threadsafe_function(completions, completion, napi_tsfn_blocking);
}

static napi_value Send(napi_env env, napi_callback_info info) {
    size_t count = 1;
    napi_value args[1], promise;
    napi_get_cb_info(env, info, &count, args, NULL, NULL);
    void *bytes = NULL;
    size_t length = 0;
    napi_typedarray_type type;
    napi_value arrayBuffer;
    size_t offset;
    napi_get_typedarray_info(env, args[0], &type, &length, &bytes, &arrayBuffer, &offset);
    Completion *completion = calloc(1, sizeof(Completion));
    napi_create_promise(env, &completion->deferred, &promise);
    su_send(bytes, length, completion, on_done); // Swift copies the bytes before returning
    return promise;
}

static napi_value Receive(napi_env env, napi_callback_info info) {
    size_t count = 1;
    napi_value args[1], promise;
    napi_get_cb_info(env, info, &count, args, NULL, NULL);
    int64_t max_length = 0;
    napi_get_value_int64(env, args[0], &max_length);
    Completion *completion = calloc(1, sizeof(Completion));
    napi_create_promise(env, &completion->deferred, &promise);
    su_receive((size_t)max_length, completion, on_data);
    return promise;
}

static napi_threadsafe_function make_listener(napi_env env, napi_value function, const char *label,
                                              napi_threadsafe_function_call_js call, size_t queue) {
    napi_value name;
    napi_threadsafe_function listener;
    napi_create_string_utf8(env, label, NAPI_AUTO_LENGTH, &name);
    napi_create_threadsafe_function(env, function, NULL, name, queue, 1, NULL, NULL, NULL, call, &listener);
    napi_unref_threadsafe_function(env, listener);
    return listener;
}

// Camera events: the interrupt endpoint's packets, to one listener.
static napi_threadsafe_function events = NULL;

static void deliver_event(napi_env env, napi_value js_callback, void *context, void *data) {
    Bytes *bytes = data;
    if (env) {
        napi_value argument = to_buffer(env, *bytes), undefined;
        napi_get_undefined(env, &undefined);
        napi_call_function(env, undefined, js_callback, 1, &argument, NULL);
    } else
        free(bytes->data);
    free(bytes);
}

static void on_event(void *context, int32_t status, const uint8_t *data, size_t length) {
    Bytes *bytes = malloc(sizeof(Bytes));
    *bytes = copy_bytes(data, length);
    napi_call_threadsafe_function(events, bytes, napi_tsfn_nonblocking);
}

static napi_value OnEvent(napi_env env, napi_callback_info info) {
    size_t count = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &count, args, NULL, NULL);
    if (events) napi_release_threadsafe_function(events, napi_tsfn_abort);
    events = make_listener(env, args[0], "swift-usb-events", deliver_event, 0);
    su_events(NULL, on_event);
    return NULL;
}

static napi_value Open(napi_env env, napi_callback_info info) {
    size_t count = 2;
    napi_value args[2], result;
    napi_get_cb_info(env, info, &count, args, NULL, NULL);
    int32_t vendor = 0, product = 0;
    napi_get_value_int32(env, args[0], &vendor);
    if (count > 1) napi_get_value_int32(env, args[1], &product);
    napi_get_boolean(env, su_open(vendor, product) != 0, &result);
    return result;
}

static napi_value Close(napi_env env, napi_callback_info info) {
    su_close();
    return NULL;
}

static napi_value Reset(napi_env env, napi_callback_info info) {
    napi_value result;
    napi_get_boolean(env, su_reset() != 0, &result);
    return result;
}

// Live-view frames, to one listener. Frames queue at most two deep: a main process that falls behind skips frames.
static napi_threadsafe_function frames = NULL;

#define KEPT_PICTURES 8
static CVPixelBufferRef kept[KEPT_PICTURES];
static int keptIndex = 0;

typedef struct {
    int stopped;
    CVPixelBufferRef picture;
    int32_t width, height;
    Bytes jpeg, focal;
} Frame;

static void discard_frame(Frame *frame) {
    if (frame->picture) CVPixelBufferRelease(frame->picture);
    free(frame->jpeg.data);
    free(frame->focal.data);
    free(frame);
}

static void deliver_frame(napi_env env, napi_value js_callback, void *context, void *data) {
    Frame *frame = data;
    if (!env) return discard_frame(frame);
    napi_value argument, undefined;
    napi_get_undefined(env, &undefined);
    if (frame->stopped) {
        napi_get_null(env, &argument);
    } else {
        napi_value surface, width, height;
        IOSurfaceRef handle = frame->picture ? CVPixelBufferGetIOSurface(frame->picture) : NULL;
        napi_create_object(env, &argument);
        napi_create_buffer_copy(env, handle ? sizeof(handle) : 0, handle ? (void *)&handle : (void *)"", NULL, &surface);
        napi_create_int32(env, frame->width, &width);
        napi_create_int32(env, frame->height, &height);
        napi_set_named_property(env, argument, "surface", surface);
        napi_set_named_property(env, argument, "width", width);
        napi_set_named_property(env, argument, "height", height);
        napi_set_named_property(env, argument, "jpeg", to_buffer(env, frame->jpeg));
        napi_set_named_property(env, argument, "focal", to_buffer(env, frame->focal));
        frame->jpeg.data = NULL;
        frame->focal.data = NULL;
        // The last few pictures stay alive here; Electron retains the surface it imports for as long as it needs it.
        if (frame->picture) {
            if (kept[keptIndex]) CVPixelBufferRelease(kept[keptIndex]);
            kept[keptIndex] = frame->picture;
            keptIndex = (keptIndex + 1) % KEPT_PICTURES;
            frame->picture = NULL;
        }
    }
    napi_call_function(env, undefined, js_callback, 1, &argument, NULL);
    discard_frame(frame);
}

static void on_frame(void *context, int32_t kind, void *picture, int32_t width, int32_t height, const uint8_t *jpeg,
                     size_t jpeg_length, const uint8_t *focal, size_t focal_length) {
    Frame *frame = calloc(1, sizeof(Frame));
    frame->stopped = kind == 0;
    frame->picture = picture;
    frame->width = width;
    frame->height = height;
    frame->jpeg = copy_bytes(jpeg, jpeg_length);
    frame->focal = copy_bytes(focal, focal_length);
    if (napi_call_threadsafe_function(frames, frame, napi_tsfn_nonblocking) != napi_ok) discard_frame(frame);
}

static napi_value StartLiveView(napi_env env, napi_callback_info info) {
    size_t count = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &count, args, NULL, NULL);
    bool decode_on_gpu = true;
    napi_get_value_bool(env, args[0], &decode_on_gpu);
    if (frames) napi_release_threadsafe_function(frames, napi_tsfn_abort);
    frames = make_listener(env, args[1], "swift-usb-frames", deliver_frame, 2);
    su_live_start(decode_on_gpu ? 1 : 0, NULL, on_frame);
    return NULL;
}

static napi_value StopLiveView(napi_env env, napi_callback_info info) {
    su_live_stop();
    return NULL;
}

static napi_value LiveStatistics(napi_env env, napi_callback_info info) {
    static const char *names[] = {"frames", "requests", "refusals", "repeated", "decoded"};
    int64_t values[5] = {0};
    su_live_statistics(values);
    napi_value result;
    napi_create_object(env, &result);
    for (int index = 0; index < 5; index++) {
        napi_value value;
        napi_create_int64(env, values[index], &value);
        napi_set_named_property(env, result, names[index], value);
    }
    return result;
}

static void copy_latest(void *context, int32_t status, const uint8_t *data, size_t length) {
    *(Bytes *)context = copy_bytes(data, length);
}

static napi_value LatestJpeg(napi_env env, napi_callback_info info) {
    Bytes bytes = {NULL, 0};
    su_live_latest_jpeg(&bytes, copy_latest);
    if (!bytes.data) {
        napi_value nothing;
        napi_get_null(env, &nothing);
        return nothing;
    }
    return to_buffer(env, bytes);
}

static napi_value Init(napi_env env, napi_value exports) {
    napi_value name;
    napi_create_string_utf8(env, "swift-usb-completions", NAPI_AUTO_LENGTH, &name);
    napi_create_threadsafe_function(env, NULL, NULL, name, 0, 1, NULL, NULL, NULL, settle, &completions);
    napi_unref_threadsafe_function(env, completions);
    napi_property_descriptor methods[] = {
        {"open", NULL, Open, NULL, NULL, NULL, napi_default, NULL},
        {"close", NULL, Close, NULL, NULL, NULL, napi_default, NULL},
        {"send", NULL, Send, NULL, NULL, NULL, napi_default, NULL},
        {"receive", NULL, Receive, NULL, NULL, NULL, napi_default, NULL},
        {"reset", NULL, Reset, NULL, NULL, NULL, napi_default, NULL},
        {"onEvent", NULL, OnEvent, NULL, NULL, NULL, napi_default, NULL},
        {"startLiveView", NULL, StartLiveView, NULL, NULL, NULL, napi_default, NULL},
        {"stopLiveView", NULL, StopLiveView, NULL, NULL, NULL, napi_default, NULL},
        {"liveStatistics", NULL, LiveStatistics, NULL, NULL, NULL, napi_default, NULL},
        {"latestJpeg", NULL, LatestJpeg, NULL, NULL, NULL, napi_default, NULL},
    };
    napi_define_properties(env, exports, sizeof(methods) / sizeof(*methods), methods);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
