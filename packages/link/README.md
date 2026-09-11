# <a href="https://darkgrade.com" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="../../apps/darkgrade.com/public/darkgrade_combo_dark.svg"><img style="height:30px;" src="../../apps/darkgrade.com/public/darkgrade_combo_light.svg"></picture></a>

Darkgrade Link package

[darkgrade.com/docs](https://darkgrade.com/docs)

## Capability-driven standard controls

Use `camera.getStandardPropertyStates()` for generic PTP and Olympus bodies. It returns only recognized properties advertised by the attached camera, including live value, writability, enum choices, and ranges. `camera.setStandardProperty(name, value)` rejects absent/read-only properties and unadvertised enum values before writing.

The Olympus E-PL5 hardware test exposes battery and writable date/time in MTP mode, but no ISO, aperture, shutter, white balance, focus, or remote-capture operation. Newer Olympus bodies automatically gain whatever standard controls they actually publish; support is not inferred from the brand name.
