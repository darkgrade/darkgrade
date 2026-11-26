# <a href="https://darkgrade.com" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="apps/darkgrade.com/public/darkgrade_combo_dark.svg"><img alt="Darkgrade" height="30" style="height:30px;" src="apps/darkgrade.com/public/darkgrade_combo_light.svg"></picture></a>

Local-first AI for creative professionals.

**[darkgrade.com →](https://darkgrade.com)**

**Shoot more. Edit less.** Darkgrade dials in your camera, captures the shot, and, soon, returns a first
cut, on your own machine. You stay the director.

## How it works

### Studio: one tap & we’re rolling

An app that sets your camera, takes orders by voice and, soon, hands you a first cut.

- Your camera, set in one tap
- Works with the Sony, Nikon and Canon cameras you already own
- Voice control for your camera
- Next: a first cut soon after you stop recording

### Slate: your camera takes requests now

A library that lets your app, script or local model run your camera. Open source and free to use.

- Control your camera from your own app
- Sony, Nikon and Canon through one API
- Local models drive it over MCP
- Next: more camera brands

```sh
npm i @darkgrade/slate
```

```typescript
import { Camera } from '@darkgrade/slate'

const camera = new Camera()
await camera.connect()
try {
    console.log(await camera.setIso('ISO 800')) // the value the camera read back
    const photo = await camera.takePhoto()
    console.log(photo.name)
} finally {
    await camera.disconnect()
}
```

The same operations are MCP tools (`camera_set_iso`, `camera_take_photo`) and terminal commands
(`darkgrade camera set-iso 'ISO 800'`).

Camera control, speech recognition and text models run on your machine by default.
See [which cameras we’ve tested](https://darkgrade.com/docs/slate/getting_started/feature-compatibility)
and [the docs](https://darkgrade.com/docs/slate).

## Run locally

```sh
bun install
bun run studio
```

Needs an Apple silicon Mac.

Slate also owns the [telemetry client and server](packages/slate/telemetry/README.md).
The server is an explicit `@darkgrade/slate/telemetry/server` entry, with a separate
Postgres adapter; importing camera or browser APIs does not start it.
