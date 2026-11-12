"""
Serves an Underdog Bark 3.0 model (3.0 or Plus on MLX, Pro on transformers) over the OpenAI transcription API for Darkgrade Studio:
POST /v1/audio/transcriptions with multipart "file" = 16 kHz mono WAV, answered with {"text": ...}.
GET /health answers once the model is loaded.

Copied from Voicebench's bench/runners/transcription_server.py (the Bark loaders only), so Studio
runs the model exactly as it was scored. The model's own loading code (bark_mlx.py) comes with the
model download, pinned to a revision and checked against known hashes by Studio before this starts.
Silero VAD's model is served from the pinned silero-vad package for the transcription worker.

    python transcription_server.py --runner mlx|transformers --path MODEL_DIRECTORY --port N
"""
import argparse
import io
import json
import os
import sys
import warnings
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import soundfile

import importlib.util


def load_mlx(path):
    """Bark 3.0 and 3.0 Plus, through the model's own bark_mlx.py (hash-checked by Studio)."""
    sys.path.insert(0, path)
    import bark_mlx

    model = bark_mlx.load_model(f"{path}/model.bark", bits=16, cache_dir=f"{path}/mlx-converted")
    return lambda wave: bark_mlx.transcribe(model, wave, 16000)


def load_transformers(path):
    """Bark 3.0 Pro, as Voicebench and the model's own runtime/transcribe_bark_pro.py run it."""
    import torch
    from transformers import AutoProcessor, ParakeetForTDT

    # generate() warns on every clip that it falls back to a default max_length; that default is
    # what Voicebench scored, so the warning is only noise in the engine log.
    warnings.filterwarnings("ignore", message=".*max_length.*")

    processor = AutoProcessor.from_pretrained(path, local_files_only=True)
    model = ParakeetForTDT.from_pretrained(path, dtype=torch.bfloat16, local_files_only=True).to("mps").eval()

    def transcribe(wave):
        padded = np.concatenate([np.zeros(4000, np.float32), wave])
        inputs = processor(padded, sampling_rate=16000, return_tensors="pt").to("mps", torch.bfloat16)
        with torch.inference_mode():
            output = model.generate(**inputs)
        ids = output.sequences if hasattr(output, "sequences") else output
        return processor.batch_decode(ids, skip_special_tokens=True)[0].strip()

    return transcribe


LOADERS = {"mlx": load_mlx, "transformers": load_transformers}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runner", choices=sorted(LOADERS), default="mlx")
    parser.add_argument("--path", required=True)
    parser.add_argument("--port", type=int, required=True)
    arguments = parser.parse_args()
    transcribe = LOADERS[arguments.runner](arguments.path)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            # The transcription worker calls this from Studio's renderer, a different origin.
            self.send_header("access-control-allow-origin", "*")
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("access-control-allow-origin", "*")
            self.send_header("access-control-allow-methods", "GET, POST")
            self.send_header("access-control-allow-headers", "content-type")
            self.end_headers()

        def do_GET(self):
            if self.path == "/silero-vad.onnx":
                # Located without importing silero_vad, whose __init__ needs torch (not installed).
                package_directory = importlib.util.find_spec("silero_vad").submodule_search_locations[0]
                with open(os.path.join(package_directory, "data", "silero_vad.onnx"), "rb") as model_file:
                    data = model_file.read()
                self.send_response(200)
                self.send_header("access-control-allow-origin", "*")
                self.send_header("content-type", "application/octet-stream")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            self.reply(200, {"status": "ok"})

        def do_POST(self):
            length = int(self.headers["content-length"])
            message = BytesParser(policy=default).parsebytes(
                f"content-type: {self.headers['content-type']}\r\n\r\n".encode() + self.rfile.read(length)
            )
            audio = next(part for part in message.iter_parts() if part.get_param("name", header="content-disposition") == "file")
            wave, rate = soundfile.read(io.BytesIO(audio.get_payload(decode=True)), dtype="float32")
            if wave.ndim > 1:
                wave = wave.mean(axis=1)
            if rate != 16000:
                self.reply(400, {"error": "send 16 kHz audio"})
                return
            try:
                self.reply(200, {"text": transcribe(np.ascontiguousarray(wave))})
            except Exception as error:  # reported to Studio as a failed utterance
                self.reply(500, {"error": str(error)})

    print(f"listening on 127.0.0.1:{arguments.port}", flush=True)
    HTTPServer(("127.0.0.1", arguments.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
