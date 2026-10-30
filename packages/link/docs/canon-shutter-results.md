# Canon shutter acceptance is separate from PTP acceptance

On 2026-10-30, EOS R6 Mark III firmware 1.0.1 on darkgrade02 was tested over USB
with its physical selector in Movie, through leased bench MCP jobs.
The diagnostic bypassed `withCanonPhotoMode`; no photo-mode assumption prevented
the shutter commands from reaching the body.

| Sequence | PTP response | Shutter result | New still |
| --- | --- | --- | --- |
| Half press then full press, no AF (`0x9128`) | OK | full press: `12` | None |
| Full press alone, no AF (`0x9128`) | DeviceBusy | `0` | None |
| Combined half/full press, no AF (`0x9128`) | OK | `12` | None |
| One-shot release (`0x910f`) | OK | `14` | None |

Button releases completed and original mode, exposure, and recording-idle state
were preserved. Each attempt checked for newly created objects rather than
downloading an old image. This is a bounded observation of this body/mode, not a
claim that every Canon camera or every possible firmware command behaves alike.

The locally supplied Canon EDSDK 13.20.21 Linux library confirms that
`CPtpInterface::DS_RemoteReleaseOn` and `DS_RemoteRelease` return the first response
parameter separately from the transaction status. `CPtpCamera::ReleaseSwitch` and
`TakePicture` turn a nonzero result into `0x8d00 | result`.
`EDSDKErrors.h` calls `0x8d0c` `EDS_ERR_TAKE_PICTURE_SPECIAL_MOVIE_MODE_NG` and
`0x8d0e` `EDS_ERR_TAKE_PICTURE_MOVIE_MODE_NG`.

Static evidence: library SHA-256
`12627628897d4ff2fce6dc4b04d7c0c4d66a7c2f87c145894f56c18129cc7333`;
REA/Ghidra `ReleaseSwitch`
`ev_ff0a2d57a7d99de46d7ee9b96ffcbf1ab9ef4a449873ce8b5ad5498b054a414e`,
`TakePicture`
`ev_3fa1f2fc2c118bb65dc1a802f11030178ee967b23dffabb32fe38f0865c6db56`.
Decompilation establishes SDK behavior; the separate MCP observations establish
what this physical camera returned.

Darkgrade must reject a nonzero result even when PTP returns OK. It must still
release acknowledged buttons and must not blindly repeat a shutter command after
a mode-related rejection. Zero or an omitted optional result remains accepted
for older EOS bodies; a higher-level capture-and-download check must verify a
new image when capture completion is required.
