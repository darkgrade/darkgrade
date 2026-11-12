"""Load a .bark file into a stock transformers ParakeetForTDT and transcribe.

Formats "bark-levels-v2" and "bark-levels-v3" (v3 = v2 with LZMA on the small side blobs: levels, scales, fp16 tensors):
  encoder linear weights: per-row levels (fp16) + one code per weight, entropy coded with ANS
    (16 column classes per tensor, each with its own symbol model);
  other matrices: per-row symmetric integers (5 or 6 bits), ANS coded, with fp16 row scales;
  small tensors: fp16.
Decoding is exact: the weights you get are the weights that were evaluated.

  pip install "transformers>=5.19" torch constriction numpy soundfile soxr
  python bark_loader.py model.bark recording.wav
"""
import json
import lzma
import sys

import numpy as np

try:
    import torch
except ImportError:          # the MLX path (bark_mlx.py) only needs numpy
    torch = None

NC = 16


def _decode_codes(cls, counts, words, rows, cols):
    import constriction
    dec = constriction.stream.stack.AnsCoder(words)
    codes = np.empty((rows, cols), np.uint8)
    for c in range(len(counts)):
        idx = np.nonzero(cls == c)[0]
        model = constriction.stream.model.Categorical(counts[c] / counts[c].sum(), perfect=False)
        codes[:, idx] = dec.decode(model, rows * len(idx)).reshape(len(idx), rows).T
    return codes


def _levels_to_weights(lev, codes):
    K = lev.shape[1]
    lev = lev.astype(np.float32)
    mag = np.where(codes == 0, 0, np.where(codes <= K, codes, codes - K)).astype(np.int64)
    val = np.take_along_axis(np.concatenate([np.zeros((lev.shape[0], 1), np.float32), lev], 1), mag, 1)
    return np.where(codes > K, -val, val)


def _unz(b, flag):
    return lzma.decompress(b) if flag else b


def load_state_dict(path, as_numpy=False):
    """Returns (state_dict, model_config_dict). as_numpy=True skips torch (used by bark_mlx.py)."""
    import constriction
    raw = open(path, "rb").read()
    n = int.from_bytes(raw[:8], "little")
    head = json.loads(raw[8:8 + n])
    assert head["format"] in ("bark-levels-v2", "bark-levels-v3"), head["format"]
    p = 8 + n
    sd = {}
    for e in head["index"]:
        shape = e["shape"]
        if e["k"] == "levels2":
            K, rows, cols = e["K"], shape[0], int(np.prod(shape[1:]))
            lev = np.frombuffer(_unz(raw[p:p + e["lev"]], e.get("zl")), np.float16).reshape(rows, K); p += e["lev"]
            meta = raw[p:p + e["meta"]]; p += e["meta"]
            nb = (cols * 4 + 7) // 8
            bits = np.unpackbits(np.frombuffer(meta[:nb], np.uint8))[:cols * 4].reshape(cols, 4)
            cls = np.packbits(np.concatenate([np.zeros((cols, 4), np.uint8), bits], 1), axis=1)[:, 0]
            counts = np.frombuffer(meta[nb:], np.uint32).reshape(NC, 2 * K + 1).astype(np.float64)
            words = np.frombuffer(raw[p:p + e["b"]], np.uint32).copy(); p += e["b"]
            codes = _decode_codes(cls, counts, words, rows, cols)
            sd[e["n"]] = _levels_to_weights(lev, codes).reshape(shape)
        elif e["k"].startswith("ansint"):
            bits = int(e["k"][6:])
            scale = np.frombuffer(_unz(raw[p:p + e["s"]], e.get("zs")), np.float16).astype(np.float32); p += e["s"]
            counts = np.frombuffer(raw[p:p + e["meta"]], np.uint32).astype(np.float64); p += e["meta"]
            words = np.frombuffer(raw[p:p + e["b"]], np.uint32).copy(); p += e["b"]
            model = constriction.stream.model.Categorical(counts / counts.sum(), perfect=False)
            sym = constriction.stream.stack.AnsCoder(words).decode(model, int(np.prod(shape)))
            q = (sym - (2 ** (bits - 1) - 1)).astype(np.float32)
            sd[e["n"]] = (q.reshape(len(scale), -1) * scale[:, None]).reshape(shape)
        elif e["k"] == "raw":
            dtype = {"torch.int64": np.int64, "torch.int32": np.int32}.get(e["dtype"], np.float16)
            sd[e["n"]] = np.frombuffer(_unz(raw[p:p + e["b"]], e.get("zr")), dtype).copy().reshape(shape); p += e["b"]
        else:
            raise ValueError(e["k"])
    if not as_numpy:
        sd = {k: torch.from_numpy(v) for k, v in sd.items()}
    return sd, json.loads(head["config"])


def load_model(path, device="cpu", dtype=None):
    from transformers import GenerationConfig, ParakeetForTDT, ParakeetTDTConfig
    sd, cfg = load_state_dict(path)
    model = ParakeetForTDT(ParakeetTDTConfig.from_dict(cfg))
    missing, unexpected = model.load_state_dict({k: v.float() for k, v in sd.items()}, strict=False)
    assert not unexpected and all("num_batches_tracked" in m for m in missing), (missing[:5], unexpected[:5])
    model.generation_config = GenerationConfig.from_pretrained("nvidia/parakeet-tdt-0.6b-v3")
    return model.eval().to(device=device, dtype=dtype or torch.float32)


def transcribe(model, wave, sample_rate=16000, pad_s=0.25):
    """wave: mono float32 numpy array. pad_s: silence added before the audio (the evaluated setting)."""
    from transformers import AutoProcessor
    if sample_rate != 16000:
        import soxr
        wave = soxr.resample(wave, sample_rate, 16000)
    wave = np.concatenate([np.zeros(int(pad_s * 16000), np.float32), wave.astype(np.float32)])
    proc = AutoProcessor.from_pretrained("nvidia/parakeet-tdt-0.6b-v3")
    dev, dt = next(model.parameters()).device, next(model.parameters()).dtype
    inp = proc([wave], sampling_rate=16000, return_tensors="pt", padding=True)
    inp = {k: (v.to(dev, dt) if v.dtype.is_floating_point else v.to(dev)) for k, v in inp.items()}
    with torch.inference_mode():
        out = model.generate(**inp)
    return proc.batch_decode(out.sequences, skip_special_tokens=True)[0].strip()


if __name__ == "__main__":
    import soundfile as sf
    model = load_model(sys.argv[1])
    wave, sr = sf.read(sys.argv[2], dtype="float32", always_2d=True)
    print(transcribe(model, wave.mean(1), sr))
