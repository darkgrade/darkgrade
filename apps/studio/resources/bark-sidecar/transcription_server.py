"""
Serves Underdog Bark 3.0 Plus (MLX) over the OpenAI transcription API for Darkgrade Studio:
POST /v1/audio/transcriptions with multipart "file" = 16 kHz mono WAV, answered with {"text": ...}.
GET /health answers once the model is loaded.

Copied from Voicebench's bench/runners/transcription_server.py (the bark-plus loader only), so Studio
runs the model exactly as it was scored. The model's own code is vendored and pinned in
vendor/underdog_bark; nothing is imported from the downloaded model folder.

    python transcription_server.py --path MODEL_DIRECTORY --port N
"""
import argparse
import io
import json
import os
import sys
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import soundfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor", "underdog_bark"))
import bark_mlx  # noqa: E402


def load_bark_plus(path):
    # bark_mlx copies its tokenizer and config from HERE/mlx; those come with the downloaded model.
    bark_mlx.HERE = path
    model = bark_mlx.load_model(f"{path}/model.bark", bits=16, cache_dir=f"{path}/mlx-converted")
    return lambda wave: bark_mlx.transcribe(model, wave, 16000)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", required=True)
    parser.add_argument("--port", type=int, required=True)
    arguments = parser.parse_args()
    transcribe = load_bark_plus(arguments.path)

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
