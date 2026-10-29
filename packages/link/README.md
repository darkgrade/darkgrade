# <a href="https://darkgrade.com" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="../../apps/darkgrade.com/public/darkgrade_combo_dark.svg"><img style="height:30px;" src="../../apps/darkgrade.com/public/darkgrade_combo_light.svg"></picture></a>

Darkgrade Link package

[darkgrade.com/docs](https://darkgrade.com/docs)

## Canon EOS R6 Mark III

Canon USB live-view JPEG capture, preview magnification, color temperature and live-view autofocus area controls are verified on the EOS R6 Mark III. Property setters wait for event readback, and live view restores the previous camera/host output. See the [SDK comparison and hardware evidence](docs/canon-r6-iii-sdk-audit.md) for the API, tested capabilities, retained traces and remaining gaps.

## Capability-driven standard controls

Use `camera.getStandardPropertyStates()` for generic PTP and Olympus bodies. It returns only recognized properties advertised by the attached camera, including live value, writability, enum choices, and ranges. `camera.setStandardProperty(name, value)` rejects absent/read-only properties and unadvertised enum values before writing.

The Olympus E-PL5 hardware test exposes battery and writable date/time in MTP mode, but no ISO, aperture, shutter, white balance, focus, or remote-capture operation. Newer Olympus bodies automatically gain whatever standard controls they actually publish; support is not inferred from the brand name.

## Video shoots

Use the shared [video shooting APIs](docs/video-shooting.md) for multi-camera takes, verified original transfer, video exposure setup and persistent per-camera evidence. `VideoTake` accepts camera adapters; `UsbVideoRecording` and `SonyVideoRecording` implement the recording/media operations. Applications own process leases, storage and their UI.

Validate the built ESM and CommonJS package entries with `bun run test:package` from this directory. This imports the public package under Node and does not connect to hardware.

## Collecting replay evidence over USB

Construct `USBTransport(logger, { maxBulkReadBytes: 16384 })`, or pass the same option
to `TransportFactory.createUSBTransport()`, while recording Linux usbmon traffic.
The transport reassembles complete PTP containers across these smaller reads;
ordinary connections retain their existing transfer sizes. The bounded
`bench:probe` uses this setting automatically.

This addresses captures whose IN completion has a nonzero transfer length but
`flag_data='D'` and no payload. Linux's
[`mon_bin_get_data`](https://github.com/torvalds/linux/blob/master/drivers/usb/mon/mon_bin.c)
cannot copy IOMMU-coalesced scatter/gather buffers. Its
[`usbfs` submission path](https://github.com/torvalds/linux/blob/master/drivers/usb/core/devio.c)
uses 16 KiB segments and avoids scatter/gather for a one-segment transfer.
This makes new captures possible; it cannot recover bytes absent from an old trace.
Check the resulting capture for complete command, data and response phases before
importing it as camera evidence.
