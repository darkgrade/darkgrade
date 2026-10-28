# Camera catalog

`camera-lines.json` lists camera manufacturers, their product lines, every known model with its USB identity, and the protocol quirks of each line. `scripts/camera-profiles/build-documented-profiles.ts` turns it into one documented profile per line, and the simulation suite uses it to roll results up by line.

It contains facts and citations only, no source code.

## Sources

- **libgphoto2** `camlibs/ptp2`, pinned at commit [`02d92fea8a269eb94330a4eade204ba799433606`](https://github.com/gphoto/libgphoto2/tree/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2). This is the primary source for the model table, USB vendor and product IDs, the `PTP_CAP` / `PTP_CAP_PREVIEW` / bug flags, and every opcode, event, response and property number. Each entry cites a line permalink. The quirk sequences describe what libgphoto2 does, which hints at what the camera needs but is not vendor documentation.
- **Vendor SDK and tether pages** (Canon EDSDK/CCAPI, Nikon SDK, Sony Camera Remote SDK, Fujifilm SDK, LUMIX Tether, OM Capture, IMAGE Transmitter 2, Leica). These pages could not be fetched when the catalog was built. The model lists come from search summaries of the pages and are marked `"unverified": true`. The Nikon Remote Module SDK model list is second-hand (a forum thread quoting release notes).

## Confidence

- **High:** USB VID/PID and gphoto flags for the roughly 800 models that have them; opcodes checked against `ptp.h`.
- **Unverified or weak:**
    - Canon 64-bit object operations (0x9170-0x9175): it is not known which bodies use them.
    - Nikon 0x943A-0x943C (darkgrade's DevicePropDescEx/ValueEx/SetEx): these are not in libgphoto2.
    - Sony 0x9251.
    - Panasonic S-series: no USB PIDs, so it has no mock.
    - Pentax/Ricoh: no vendor operations are documented.
    - Hasselblad: no USB or PTP evidence, so it has no mock.
    - Sigma BF: no tether evidence.
    - Cinema EOS C-series and Sony FX6/FX30: no PTP evidence.
    - The DSLR mirror live-view delay and Sony access-authentication quirks are inferred.
- **Not included:** Phase One, DJI and Blackmagic. No PTP tethering evidence was found for them.

`darkgradeGaps` records the vendor IDs, vendor definitions and operations that darkgrade does not yet have. The simulation matrix reports the same gaps per line as "Vendor op definitions: unsupported".

Profiles built from this catalog have `provenance.fidelity: "documented"`. They are not hardware-verified.
