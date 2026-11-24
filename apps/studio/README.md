# Darkgrade Studio

One tap & we’re rolling.

An app that sets your camera, takes orders by voice and, soon, hands you a first cut. Camera control,
speech recognition and text models run on your own machine.

## How it works

Plug in a Sony, Nikon or Canon camera over USB and Studio connects to it. From one screen you can set
exposure, focus and white balance, watch live view, take a photo or record, and download what’s on the
card. Return takes a photo and F focuses.

Press **Voice** and say what you want: *“set ISO to 800”*, *“take a photo”*, *“start recording”*.

To let an assistant like Claude run the camera, turn on **Let AI apps control the camera** in
Preferences. Only apps on your Mac can connect.

## Run locally

```bash
bun install
bun run studio
```

Needs an Apple silicon Mac. Voice needs Python 3.11 (`brew install python@3.11`) and downloads its
speech model, Underdog Bark 3.0 Plus (CC BY-NC 4.0), on first use. `bun run studio:bundle` builds the
Mac app.
