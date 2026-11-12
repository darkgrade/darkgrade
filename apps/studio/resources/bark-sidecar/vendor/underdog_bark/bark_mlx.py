"""Run model.bark on Apple silicon with MLX (mlx-audio's Parakeet graph).

The first run unpacks model.bark into an MLX folder (fp16 by default, or 4-bit affine with --bits 4) and caches it;
later runs load the cached folder directly. Unpacking needs about 6 GB of RAM once. Transcription adds 0.25 s of silence
before the audio, the evaluated setting. On an M2, fp16 decodes faster than 4-bit; 4-bit uses less memory.

  pip install mlx mlx-audio constriction numpy soundfile soxr
  python bark_mlx.py recording.wav                 # fp16, cached in ./bark_mlx_fp16
  python bark_mlx.py recording.wav --bits 4        # 4-bit, cached in ./bark_mlx_4bit
"""
import argparse
import json
import os
import re
import shutil

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))

_RENAMES = [
    (r"encoder\.subsampling\.layers\.", "encoder.pre_encode.conv."), (r"encoder\.subsampling\.linear\.", "encoder.pre_encode.out."),
    (r"\.conv\.norm\.", ".conv.batch_norm."), (r"\.q_proj\.", ".linear_q."), (r"\.k_proj\.", ".linear_k."),
    (r"\.v_proj\.", ".linear_v."), (r"\.o_proj\.", ".linear_out."), (r"\.relative_k_proj\.", ".linear_pos."),
    (r"\.bias_u$", ".pos_bias_u"), (r"\.bias_v$", ".pos_bias_v"), (r"^decoder\.embedding\.", "decoder.prediction.embed."),
    (r"^encoder_projector\.", "joint.enc."), (r"^decoder\.decoder_projector\.", "joint.pred."), (r"^joint\.head\.", "joint.joint_net.2."),
]


def to_mlx_names(sd):
    """transformers ParakeetForTDT names/layouts -> mlx-audio Parakeet names/layouts (channels-last convs, fused LSTM bias)."""
    out = {}
    for k, v in sd.items():
        v = np.asarray(v, np.float32)
        if k.endswith("num_batches_tracked") or k.startswith("vad_head"):
            continue
        m = re.match(r"decoder\.lstm\.(weight_ih|weight_hh|bias_ih|bias_hh)_l(\d)", k)
        if m:
            kind, i = m.groups()
            base = f"decoder.prediction.dec_rnn.lstm.{i}"
            if kind == "weight_ih":
                out[f"{base}.Wx"] = v
            elif kind == "weight_hh":
                out[f"{base}.Wh"] = v
            else:
                out[f"{base}.bias"] = out.get(f"{base}.bias", 0) + v
            continue
        if re.search(r"encoder\.subsampling\.layers\.\d+\.weight$", k):
            v = v.transpose(0, 2, 3, 1)
        if re.search(r"conv\.(depthwise_conv|pointwise_conv[12])\.weight$", k):
            v = v.transpose(0, 2, 1)
        for pat, rep in _RENAMES:
            k = re.sub(pat, rep, k)
        out[k] = v
    return out


def prepare(bark_file, out_dir, bits=4):
    """Unpack model.bark into an mlx-audio model folder (cached)."""
    import mlx.core as mx
    import mlx.nn as nn
    from mlx.utils import tree_flatten
    from mlx_audio.stt import load
    from bark_loader import load_state_dict
    if os.path.exists(f"{out_dir}/model.safetensors"):
        return out_dir
    os.makedirs(out_dir, exist_ok=True)
    for f in ("config.json", "tokenizer.model", "tokenizer.vocab", "vocab.txt"):
        shutil.copy(f"{HERE}/mlx/{f}", f"{out_dir}/{f}")
    sd, _ = load_state_dict(bark_file, as_numpy=True)
    weights = {k: mx.array(v).astype(mx.float16) for k, v in to_mlx_names(sd).items()}
    mx.save_safetensors(f"{out_dir}/model.safetensors", weights)
    if bits < 16:
        model = load(out_dir, strict=True, model_type="parakeet")
        nn.quantize(model, group_size=64, bits=bits)
        mx.save_safetensors(f"{out_dir}/model.safetensors", dict(tree_flatten(model.parameters())))
        cfg = json.load(open(f"{out_dir}/config.json"))
        cfg["quantization"] = {"bits": bits, "group_size": 64, "mode": "affine"}
        json.dump(cfg, open(f"{out_dir}/config.json", "w"))
    return out_dir


def load_model(bark_file=f"{HERE}/model.bark", bits=16, cache_dir=None):
    import mlx.core as mx
    from mlx_audio.stt import load
    cache_dir = cache_dir or os.path.join(os.getcwd(), f"bark_mlx_{'fp16' if bits >= 16 else f'{bits}bit'}")
    model = load(prepare(bark_file, cache_dir, bits), strict=True, model_type="parakeet")
    mx.eval(model.parameters())
    return model


def transcribe(model, wave, sample_rate=16000, pad_s=0.25):
    import mlx.core as mx
    if sample_rate != 16000:
        import soxr
        wave = soxr.resample(wave, sample_rate, 16000)
    wave = np.concatenate([np.zeros(int(pad_s * 16000), np.float32), np.asarray(wave, np.float32)])
    return model.generate(mx.array(wave), dtype=mx.bfloat16, chunk_duration=None, verbose=False).text.strip()


if __name__ == "__main__":
    import soundfile as sf
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("audio")
    ap.add_argument("--model", default=f"{HERE}/model.bark")
    ap.add_argument("--bits", type=int, default=16, choices=[4, 8, 16])
    a = ap.parse_args()
    model = load_model(a.model, a.bits)
    wave, sr = sf.read(a.audio, dtype="float32", always_2d=True)
    print(transcribe(model, wave.mean(1), sr))
