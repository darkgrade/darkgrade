# Sony live-view and card diagnostics

Sony USB live view requests the reserved live-view object through `GetObject`.
A transient `AccessDenied` (`0x200f`) response can mean the next frame is not ready.
Link retries that specific live-view request with a short bounded backoff. A persistent
refusal remains an error; card reads and other operations do not acquire this retry policy.

Live-view statistics count an image only after its dataset has been decoded and contains
image bytes. A rejected request or malformed dataset never increases the frame count.
Request and refusal counters remain available independently.

Protocol diagnostics correlate commands, data and responses by transaction ID. Fixed
operation labels distinguish `sony_live_view_frame`, `sony_card_index`, `sony_card_preview`
and standard storage operations. Codes are retained, including unsuccessful responses.
Object IDs, filenames, command parameters and media payloads are not retained in telemetry.
Connection changes and consent generations cannot reuse an earlier transaction label.

Use a session replay to compare a refusal with the command that produced it and the
following response. A recovered frame-read refusal is not evidence of a failed SD card,
and a successful card-index response is not independent validation of every saved file.
Older diagnostics without operation labels still require transaction matching.
