# Simulated cameras and the support matrix

`SimulatedTransport` answers PTP requests from a camera profile, so `Camera` can be exercised in CI without hardware. The `Camera simulation` workflow runs `tests/camera-simulation` on every push and pull request, uploads the resulting support matrix (JSON and Markdown) as an artifact, and writes the table to the job summary. Hardware tests (`tests/01_usb.test.ts` and similar) are not run in CI.

## Profiles

Profiles live in `camera-profiles/<manufacturer>/<line>/<id>.json` and are typed and validated by `src/transport/simulated/camera-profile.ts`. Each profile has:

- `provenance.fidelity`: `captured` (built from evidence recorded on the testbench) or `documented` (built from vendor documentation, never presented as hardware-verified). `provenance.sources` lists every file, excerpt or URL a fact came from; facts cite a source by index.
- `manufacturer`, `line`, `model`, optional `firmware` and `usb` identity.
- `deviceInfo`: a complete `raw` GetDeviceInfo dataset, or parsed fields. Operation, event and property lists are only present when the complete list is known.
- `properties`: descriptors as raw bytes or parsed fields, plus values observed on hardware for checking darkgrade's decoding.
- `exchanges`: recorded request/response pairs. Omitted request parameters or data match anything; repeated matches are consumed in recorded order and the last one repeats.
- `events`: events delivered after a given operation.
- `quirks`: line or model behaviours with a citation and a simulator `behaviour`: `device-busy`, `disconnect-on-request`, `session-id`, `strict-transaction-ids`, `event-delivery`, `property-datatype`, or `none` for behaviours documented for reference only.

The simulator resolves each request through quirks, then recorded exchanges, then standard answers derived from the profile (DeviceInfo, OpenSession/CloseSession, property descriptors with state that `SetDevicePropValue` changes). An operation missing from a complete advertised list returns `OperationNotSupported`. Anything else raises `ProfileDataMissingError`: the simulator never invents a camera response.

## Producing captured profiles

```sh
bun run --cwd packages/link profiles:ingest -- --test-bench ../test-bench
```

The ingest script reads a `darkgrade/test-bench` checkout:

1. Structured evidence under `docs/` and `artifacts/` (`*.json`, `*.jsonl`): bench-probe results (USB identity, reported PTP identity, OpenSession) and darkgrade operation logs.
2. Prose observations transcribed in `scripts/camera-profiles/test-bench-observations.ts`. Each one cites a file and a verbatim excerpt, and the script stops if an excerpt is no longer in the checkout.
3. Optional usbmon captures, which give the most complete profiles. Run the script on a bench, where captures are kept under `/var/lib/darkgrade-testbench`:

   ```sh
   bun run profiles:ingest -- --test-bench ~/darkgrade-testbench \
       --capture canon-eos-r6-mark-iii=/var/lib/darkgrade-testbench/captures/<trace>.pcapng
   ```

   Only transactions whose every phase was captured in full are kept; GetDeviceInfo and GetDevicePropDesc responses become the profile's DeviceInfo and descriptors.

## Adding a camera

1. Add its observations to `test-bench-observations.ts` (identity, line, and any exchanges or quirks the evidence states), citing excerpts.
2. Capture a session on the bench with the `camera-re-capture` skill, including a connect, `GetDeviceInfo`, the property descriptors you need and any operations to cover, then ingest it with `--capture`.
3. Run `bun run --cwd packages/link test:simulation` and `bun run --cwd packages/link simulation:matrix`, and check `test-results/camera-support-matrix.md`.

A capability is reported as `pass`, `fail`, `unsupported` (the camera answered `OperationNotSupported`/`DevicePropNotSupported`, or darkgrade does not offer it for that vendor), or `no-data`. A `fail` in a captured profile fails the suite, because it means darkgrade mishandles data a real camera produced.
