# Protocol evidence moved from the root README

Bench findings and protocol research that used to sit in the repository README.
They record what was observed on specific bodies and dates; they are not usage documentation.

## Olympus E-PL5 inventory

The attached Olympus E-PL5 (`07b4:012f`, firmware 1.00) was physically inventoried in MTP mode on 2026-08-25. It publishes five property identifiers, but only recognized standard `BatteryLevel` (`0x5001`, read-only) and `DateTime` (`0x5011`, writable); three vendor MTP identifiers remain intentionally non-editable. It does not publish `FNumber`, `ExposureTime`, `ExposureIndex`, `WhiteBalance`, `FocusMode`, or `InitiateCapture`. A date/time write and readback succeeded, while an ISO request was rejected before any write. This matches the [official E-PL5 manual](https://download.omsystem.com/pages/inst/epl5/manual_epl5_ENU.pdf#page=97), which documents Storage/MTP transfer and says camera controls cannot be used while the camera is connected to a computer. Newer Olympus bodies that advertise standard exposure properties will populate the same inventory without a model allowlist.

## EOS 80D PTP/IP pairing

Physical EOS 80D first-pairing validation is still WIP on the reference test bench. On
2026-08-25, the isolated adapter joined the camera AP and routed the camera host correctly,
but the body emitted repeated `ssdp:byebye` notifications, never the expected alive
announcement, and displayed **Connection target not found** before presenting the
Darkgrade client for approval. The transport tests prove protocol behavior against a
two-channel simulator; they do not constitute a successful physical Wi-Fi session.

For a bounded bench command:

```bash
bun run --cwd packages/slate bench:ptpip -- \
  --host 192.168.1.1 --local-address 192.168.1.2 --action probe
```

Supported actions are `probe`, `canon-status`, `exposure-status`, `autofocus`, `keep-awake`, `set-focus-mode`, `set-white-balance`, `set-image-format`, `set-continuous-autofocus`, `set-movie-servo-autofocus`, `probe-movie-mode`, `set-movie-format`, `set-iso`, `set-aperture`, `set-shutter-speed`, `storage-status`, `recent-images`, `capture`, `capture-download`, `download-latest`, and `record-clip`. Setters require exact camera-advertised values; recent-object scans are bounded; capture success requires a new card object; movie recording is limited to 1–30 seconds with stop/restoration cleanup. Use `--value`, `--limit`, `--duration-ms`, and `--output` where applicable. The testbench MCP exposes one dedicated tool per action and restores USB separately when the Wi-Fi session is finished.

## Canon network mode and HDMI

`camera.setCanonNetworkCommunicationMode(value)` accepts only a mode advertised by that camera. Passing `true` as its second argument bypasses that guard for controlled reverse-engineering only; it is not a general Wi-Fi switch. On the tested EOS 80D, forcing mode `1` was accepted for the USB session but did not advertise an AP or TCP/15740 endpoint and reset to `0` after reboot. Use `bun run --cwd packages/slate bench:canon -- --network-only` to inspect these properties; add `--force-network-mode <uint32>` only while recording the USB exchange and with a recovery path available.

The physical EOS 80D resets this property when its PTP session closes. A client that needs continuous Canon HDMI preview must therefore keep one bounded session open, serialize control requests through it or pause it around controls, and restore the prior mode in cleanup. The testbench Camera Console uses the pause/resume design and physically verified a live 1920×1080 Cam Link sensor image before and after autofocus.

## SDK and event protocol evidence

Canon event replay was checked against EDSDK 13.20.21 for Linux, x86-64
`libEDSDK.so` SHA-256 `12627628897d4ff2fce6dc4b04d7c0c4d66a7c2f87c145894f56c18129cc7333`.
Static REA 6.8 / Ghidra 12.1.4 analysis of `CPtpCamera::TranslatePropAvailList32`
confirmed that an empty incoming choice list replaces the previous cached list.
The decoder now preserves this transition, validates record boundaries, and retains
unknown event payloads without guessing their meaning. The analysis is evidence
about this SDK implementation, not physical qualification of every EOS model.
Retained analysis ID: `ev_88bce4e2731485cd5fe26eee896deea2a34ba9063870b4a0c1c522528bfdd1d2`.
Vendor binaries and decompilations remain outside this repository.

Nikon movie/SDRAM event definitions and record layouts were cross-checked against
libgphoto2 `camlibs/ptp2/ptp.h` at commit
`02d92fea8a269eb94330a4eade204ba799433606`.
Protocol regression tests cover framing, empty choices, opaque events, fallback
boundaries, and the public event APIs without requiring or modifying hardware.
