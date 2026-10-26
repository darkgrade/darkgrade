# Video shooting workflows

`@darkgrade/link` owns camera recording, original-file verification and shot setup. Applications supply device ownership, persistence and UI; they do not need to reimplement camera policy.

## Available APIs

| API | Responsibility |
| --- | --- |
| `VideoTake` | Prepare selected devices, dispatch starts, stop attempted starts after a partial failure, track each camera, collect originals and preserve unresolved states |
| `UsbVideoRecording` | Canon/Nikon movie recording, writable-card checks, new-file discovery and bounded-memory original transfer |
| `SonyVideoRecording` | USB/Wi-Fi SDK recording-state confirmation, selected-card checks and new movie discovery/transfer |
| `optimiseShot` / `analyseShot` | Measure fresh images, adjust advertised exposure choices, request autofocus and keep exposure proof separate from uncertain subject focus |
| `openCanonRecordingMode` | Enter movie mode while preserving compatible Manual settings; restore only after recording has stopped |
| `sonyMovieCard` | Check the camera-selected movie slots rather than assuming slot 1 |

```ts
import {VideoTake} from '@darkgrade/link'

const take = new VideoTake(id, 'Interview · Take 1', adapters, 30, saveSnapshot)
await take.start()
// Read take.state: per-camera recordingConfirmed and start evidence matter.
await take.stop()
await take.collect()
```

Each adapter provides `prepare`, `start`, `stop`, `collect` and `close`. USB media transfers stream into a caller-provided writer; Sony SDK transfers use an explicit local directory. Applications verify host file sizes before exposing download links. Partial or unconfirmed stops stay unresolved; camera power must not be reset to hide that state.

## Video-first setup

Use the actual recording frame rate when selecting a shutter. A composition guide is not a request to change capture resolution or crop originals. Autofocus acknowledgement and background edge detail are not proof of subject focus. Fixed Nikon movie ISO only applies in M; other exposure modes can retain automatic gain despite accepting a stored M value.

Starts are dispatched together, **not frame synchronized**. File discovery and transfer depend on the body, card and selected transport. No cloud upload or social publishing is performed by these APIs. Originals remain on camera cards.

The image analyser uses the host's ffmpeg and optionally an already-running local vision model. It never cold-loads a model in the critical setup path. Physical lighting controls require a separate light-device adapter.
