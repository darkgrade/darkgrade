# Vendor parity

✓ Slate implements it for that vendor · ✗ it doesn't · ? not measured. In brackets: what the last real-camera run saw. Measured by camera:api-check: nikon NIKON DSC Z6_3 (2026-11-25 10:20 UTC), sony ILCE-7M5 (2026-11-25 10:20 UTC), canon Canon Digital Camera (2026-11-25 10:20 UTC). Results depend on the body's mode and lens.

Operations: Sony 18/19, Canon 14/19, Nikon 15/19. Settings: Sony 27/29, Canon 16/29, Nikon 15/29.

## Needed for Canon and Nikon parity with Sony in Studio (16)

Sony has these, Studio uses them, and Canon or Nikon does not.

| Feature | Sony | Canon | Nikon |
| --- | --- | --- | --- |
| startZoom | ✓ (works) | ✗ | ✗ |
| stopZoom | ✓ (works) | ✗ | ✗ |
| getLiveViewFrame({ overlay: true }) (camera on-screen display) | ✓ (works) | ✗ | ✗ |
| Focus area (`focusArea`) | ✓ (read-only now) | ✓ (works) | ✗ |
| Subject detection (`subjectDetection`) | ✓ (read-only now) | ✗ | ✗ |
| Detection subject (`detectionSubject`) | ✓ (works) | ✗ | ✗ |
| Eye selection (`eyeSelection`) | ✓ (works) | ✗ | ✗ |
| Photo format (`photoFormat`) | ✓ (works) | ✓ (works) | ✗ |
| Photo size (`photoSize`) | ✓ (works) | ✗ | ✓ (read-only now) |
| Aspect ratio (`aspectRatio`) | ✓ (works) | ✗ | ✗ |
| JPEG quality (`jpegQuality`) | ✓ (works) | ✗ | ✗ |
| Video format (`videoFormat`) | ✓ (works) | ✓ (not in this mode) | ✗ |
| Video quality (`videoQuality`) | ✓ (read-only now) | ✗ | ✗ |
| Frame rate (`frameRate`) | ✓ (works) | ✗ | ✗ |
| Digital zoom (`digitalZoom`) | ✓ (works) | ✗ | ✗ |
| Live-view quality (`liveViewQuality`) | ✓ (works) | ✗ | ✗ |

## Other gaps against Sony (3)

| Feature | Sony | Canon | Nikon |
| --- | --- | --- | --- |
| zoomTo | ✓ (unsupported) | ✗ | ✗ |
| Picture profile (`pictureProfile`) | ✓ (works) | ✗ | ✗ |
| Flash (`flashMode`) | ✓ (failed) | ✗ | ✓ (not in this mode) |

## Missing on Sony too (3)

| Feature | Sony | Canon | Nikon |
| --- | --- | --- | --- |
| nudgeFocus | ✗ | ✗ | ✓ (works) |
| RAW compression (`rawCompression`) | ✗ | ✗ | ✓ (not in this mode) |
| Audio recording (`audioRecording`) | ✗ | ✓ (works) | ✗ |

## Everything

| Kind | Feature | Sony | Canon | Nikon | Studio uses |
| --- | --- | --- | --- | --- | --- |
| operation | autofocus | ✓ (works) | ✓ (works) | ✓ (works) | yes |
| operation | setFocusPoint | ✓ (not in this mode) | ✓ (works) | ✓ (works) | yes |
| operation | resetFocusPoint | ✓ (works) | ✓ (works) | ✓ (works) |  |
| operation | nudgeFocus | ✗ | ✗ | ✓ (works) |  |
| operation | zoomTo | ✓ (unsupported) | ✗ | ✗ |  |
| operation | startZoom | ✓ (works) | ✗ | ✗ | yes |
| operation | stopZoom | ✓ (works) | ✗ | ✗ | yes |
| operation | takePhoto | ✓ (works) | ✓ (works) | ✓ (works) | yes |
| operation | getLiveViewFrame | ✓ (works) | ✓ (works) | ✓ (works) | yes |
| operation | getRecordingState | ✓ (works) | ✓ (works) | ✓ (works) | yes |
| operation | startRecording | ✓ (works) | ✓ (works) | ✓ (works) | yes |
| operation | stopRecording | ✓ (works) | ✓ (works) | ✓ (works) | yes |
| operation | getCardStatus | ✓ (works) | ✓ (works) | ✓ (works) | yes |
| operation | listMedia | ✓ (works) | ✓ (works) | ✓ (works) | yes |
| operation | getMediaPreview | ✓ (works) | ✓ (works) | ✓ (works) | yes |
| operation | downloadMedia | ✓ (works) | ✓ (works) | ✓ (works) | yes |
| operation | getBattery | ✓ (works) | ✓ (works) | ✓ (works) | yes |
| operation | setClock | ✓ (works) | ✓ (unsupported) | ✓ (works) | yes |
| operation | getLiveViewFrame({ overlay: true }) (camera on-screen display) | ✓ (works) | ✗ | ✗ | yes |
| setting | Shutter speed (`shutterSpeed`) | ✓ (read-only now) | ✓ (works) | ✓ (read-only now) | yes |
| setting | Aperture (`aperture`) | ✓ (works) | ✓ (works) | ✓ (works) | yes |
| setting | ISO (`iso`) | ✓ (works) | ✓ (works) | ✓ (read-only now) | yes |
| setting | Exposure mode (`exposureMode`) | ✓ (works) | ✓ (read-only now) | ✓ (read-only now) | yes |
| setting | Exposure compensation (`exposureCompensation`) | ✓ (works) | ✓ (works) | ✓ (read-only now) | yes |
| setting | Metering (`meteringMode`) | ✓ (read-only now) | ✓ (works) | ✓ (works) | yes |
| setting | Photo / video (`photoVideoMode`) | ✓ (works) | ✓ (works) | ✓ (read-only now) | yes |
| setting | Drive mode (`driveMode`) | ✓ (works) | ✓ (works) | ✓ (not in this mode) |  |
| setting | White balance (`whiteBalance`) | ✓ (works) | ✓ (works) | ✓ (works) | yes |
| setting | Colour temperature (`colorTemperature`) | ✓ (read-only now) | ✓ (works) | ✓ (read-only now) | yes |
| setting | Look (`pictureStyle`) | ✓ (works) | ✓ (works) | ✓ (works) |  |
| setting | Picture profile (`pictureProfile`) | ✓ (works) | ✗ | ✗ |  |
| setting | Focus mode (`focusMode`) | ✓ (works) | ✓ (works) | ✓ (works) | yes |
| setting | Focus area (`focusArea`) | ✓ (read-only now) | ✓ (works) | ✗ | yes |
| setting | Subject detection (`subjectDetection`) | ✓ (read-only now) | ✗ | ✗ | yes |
| setting | Detection subject (`detectionSubject`) | ✓ (works) | ✗ | ✗ | yes |
| setting | Eye selection (`eyeSelection`) | ✓ (works) | ✗ | ✗ | yes |
| setting | Photo format (`photoFormat`) | ✓ (works) | ✓ (works) | ✗ | yes |
| setting | Photo size (`photoSize`) | ✓ (works) | ✗ | ✓ (read-only now) | yes |
| setting | Aspect ratio (`aspectRatio`) | ✓ (works) | ✗ | ✗ | yes |
| setting | JPEG quality (`jpegQuality`) | ✓ (works) | ✗ | ✗ | yes |
| setting | RAW compression (`rawCompression`) | ✗ | ✗ | ✓ (not in this mode) |  |
| setting | Flash (`flashMode`) | ✓ (failed) | ✗ | ✓ (not in this mode) |  |
| setting | Video format (`videoFormat`) | ✓ (works) | ✓ (not in this mode) | ✗ | yes |
| setting | Video quality (`videoQuality`) | ✓ (read-only now) | ✗ | ✗ | yes |
| setting | Frame rate (`frameRate`) | ✓ (works) | ✗ | ✗ | yes |
| setting | Audio recording (`audioRecording`) | ✗ | ✓ (works) | ✗ | yes |
| setting | Digital zoom (`digitalZoom`) | ✓ (works) | ✗ | ✗ | yes |
| setting | Live-view quality (`liveViewQuality`) | ✓ (works) | ✗ | ✗ | yes |
