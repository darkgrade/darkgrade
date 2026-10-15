# <a href="https://darkgrade.com" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="../../apps/darkgrade.com/public/darkgrade_combo_dark.svg"><img style="height:30px;" src="../../apps/darkgrade.com/public/darkgrade_combo_light.svg"></picture></a>

Darkgrade Link package

[darkgrade.com/docs](https://darkgrade.com/docs)

## Canon EOS R6 Mark III

Canon USB live-view JPEG capture, preview magnification, color temperature and live-view autofocus area controls are verified on the EOS R6 Mark III. Property setters wait for event readback, and live view restores the previous camera/host output. See the [SDK comparison and hardware evidence](docs/canon-r6-iii-sdk-audit.md) for the API, tested capabilities, retained traces and remaining gaps.

## Capability-driven standard controls

Use `camera.getStandardPropertyStates()` for generic PTP and Olympus bodies. It returns only recognized properties advertised by the attached camera, including live value, writability, enum choices, and ranges. `camera.setStandardProperty(name, value)` rejects absent/read-only properties and unadvertised enum values before writing.

The Olympus E-PL5 hardware test exposes battery and writable date/time in MTP mode, but no ISO, aperture, shutter, white balance, focus, or remote-capture operation. Newer Olympus bodies automatically gain whatever standard controls they actually publish; support is not inferred from the brand name.
