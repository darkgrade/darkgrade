# Darkgrade Studio

Desktop app for [`@darkgrade/link`](../../packages/link) — full camera control with **local AI voice**. Electron + React, everything on-device.

## Run it

```bash
bun install          # once, from repo root
bun run studio       # builds link, launches the app
```

Plug in a Sony ⍺ / Nikon Z / Canon EOS R (or any PTP camera) over USB and it auto-connects on launch.

### macOS: the camera daemon

macOS spawns `ptpcamerad` (older: `PTPCamera`, mass-storage: `mscamerad`) the moment a camera enumerates, and it claims the PTP interface before anyone else can. One kill is not enough — launchd respawns it and macOS will clobber camera access again. Studio therefore **kills these daemons every second for the entire app lifetime**, plus immediately before each connect attempt (with one retry). If a connect still fails with an access/busy error, hit **Free camera** in the top bar (or say *"fix the camera"*).

## What it does

Everything `@darkgrade/link` exposes:

| UI | Voice |
| --- | --- |
| Connect / disconnect | "connect" / "disconnect" |
| ISO, shutter, aperture (read + set) | "set ISO to 800", "shutter to 1/250", "aperture to f/2.8" |
| Capture (saved to disk + preview) | "take a photo", "capture", "shoot" |
| Live view viewport | "start live view" / "stop live view" |
| Video recording | "start recording" / "stop recording" / "cut" |
| Browse + download camera storage | "list files", "download everything", "download the latest" |
| Event log (all PTP events) | "what are my settings" |
| Kill macOS camera daemon | "fix the camera" |

## Voice control

- **Fully local.** Speech recognition is Conway Research's Underdog Bark 3.0 Plus (Voicebench's leader; CC BY-NC 4.0, commercial use needs a licence from license@conway.tech). It runs in a Python MLX sidecar (`resources/bark-sidecar`, an approved exception to the TypeScript-only rule) that the main process starts; its model code is vendored and pinned there. The model (~180 MB) downloads once. Voice needs Python 3.11 on the Mac (`brew install python@3.11`); the sidecar's environment is created on first use.
- **Utterances, live.** Silero VAD 6.2.1 (onnxruntime-web, in the transcription worker) cuts speech at 0.5 s pauses, as Voicebench does. Partial words are re-transcribed every 0.7 s while you speak and are shown only; each utterance's final words go to the assistant. All settings are in `src/shared/speech-settings.ts`.
- **Push-to-talk:** hold **Space** (or the mic button), speak, release.
- **Always listening:** toggle on, then prefix commands with the wake word — *"hey darkgrade, take a photo"*. The wake-word requirement can be disabled.
- Spoken numbers work: *"ISO sixty four hundred"*, *"shutter to one two-hundred-and-fiftieth of a second"*, *"aperture two point eight"*.

## Scripts

```bash
bun run dev        # dev mode with HMR (builds packages/link first)
bun run build      # production bundle → out/
bun run typecheck  # tsc over main + renderer
bun run test       # vitest — intent parser & number-word coverage
bun run package    # electron-builder → release/ (mac dmg/zip)
```

## Architecture

```
src/main/       Electron main — owns the camera (node-usb via @darkgrade/link)
  camera-service.ts        connect/settings/capture/live-view-loop/files/events
  macos-camera-daemon.ts   killall ptpcamerad · PTPCamera · mscamerad
  ipc-handlers.ts          one handler per camera capability
src/preload/    typed contextBridge → window.studio
src/shared/     IPC contract (channels + types)
src/renderer/   React UI
  voice/        transcription worker (Silero VAD → Bark sidecar) · intent follower
```

Live view frames stream main → renderer as JPEG buffers over IPC. All camera I/O stays in the main process; the renderer is sandbox-friendly (contextIsolation on).
