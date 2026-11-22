"""
Serves one vision model for Darkgrade Studio's Developer Mode, on this Mac's GPU (PyTorch, MPS):

    python -I vision_server.py --model depth-pro-2 --path MODEL_DIRECTORY --focal-path FOCAL_DIRECTORY --port N
    python -I vision_server.py --model sam3 --path MODEL_DIRECTORY --port N

Each model runs in its own process, so it stays loaded beside the speech engine, the assistant and the
other vision model; none of them unloads another.

GET  /health          answers once the model is loaded.
POST /v1/depth        Depth Pro 2. Body: a JPEG or PNG. Query: focal_px (optional, pixels of the image).
                      Answers depth in meters: the focal length used, the nearest, median and farthest
                      finite depth, a grid of median depths, and a coloured inverse-depth PNG (base64).
POST /v1/segment      SAM 3. Body: a JPEG or PNG. Query: prompt (a short noun phrase, required) and
                      threshold (0 to 1, default 0.5). Answers each instance's score, box and share of
                      the picture, and the picture with the instances drawn over it (PNG, base64); with
                      overlay=1, only the instances (tinted masks and outlines) on a transparent PNG, for
                      Studio to draw over its live picture.

Neither model's folder holds code: Depth Pro 2 runs through the pinned depth_pro_2 package and SAM 3
through transformers, and the weights are safetensors.
"""
import argparse
import base64
import io
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from urllib.parse import parse_qs, urlparse

import numpy as np
import torch
from PIL import Image

DEVICE = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
DEPTH_GRID = 8
# Depth Pro 2's memory grows with the picture (L: about 4 GB at 1024 x 768, 7 GB at 1920 x 1440), so larger
# pictures are scaled down to live view's size first; the focal length is scaled with them.
DEPTH_LONG_SIDE = 1024
# Instances kept per request; scores below the floor are noise and only cost memory.
MAXIMUM_INSTANCES = 32
THRESHOLD_FLOOR = 0.1
INSTANCE_COLOURS = [
    (245, 205, 138),
    (224, 72, 62),
    (90, 170, 250),
    (120, 220, 140),
    (200, 120, 240),
    (250, 150, 60),
]


def png_base64(pixels: np.ndarray) -> str:
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


def turbo(values: np.ndarray) -> np.ndarray:
    """Google's Turbo colour map (polynomial approximation), for values in 0..1: red near, blue far."""
    x = np.clip(values, 0.0, 1.0)[..., None]
    red = 0.13572138 + x * (4.61539260 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))))
    green = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))))
    blue = 0.10667330 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))))
    return (np.clip(np.concatenate([red, green, blue], axis=-1), 0, 1) * 255).astype(np.uint8)


def finite_stat(values: np.ndarray, operation) -> float | None:
    finite = values[np.isfinite(values)]
    return round(float(operation(finite)), 3) if finite.size else None


# Live overlays: each instance's mask is tinted at this opacity and outlined this many pixels wide, fully opaque.
OVERLAY_FILL_ALPHA = 110
OVERLAY_OUTLINE_PIXELS = 2


def instance_overlay(masks: list[np.ndarray], height: int, width: int) -> np.ndarray:
    """The instances alone as RGBA: each mask tinted in its colour and outlined, transparent everywhere else."""
    overlay = np.zeros((height, width, 4), np.uint8)
    for index, mask in enumerate(masks):
        colour = INSTANCE_COLOURS[index % len(INSTANCE_COLOURS)]
        inner = mask.copy()
        for _ in range(OVERLAY_OUTLINE_PIXELS):
            shrunk = inner.copy()
            shrunk[1:, :] &= inner[:-1, :]
            shrunk[:-1, :] &= inner[1:, :]
            shrunk[:, 1:] &= inner[:, :-1]
            shrunk[:, :-1] &= inner[:, 1:]
            inner = shrunk
        overlay[mask] = (*colour, OVERLAY_FILL_ALPHA)
        overlay[mask & ~inner] = (*colour, 255)
    return overlay


def load_depth_pro_2(path: str, focal_path: str):
    """Depth Pro 2 in bfloat16 autocast on the GPU (as Apple trained and evaluated it), with its shared focal estimator."""
    from depth_pro_2 import DepthPro2
    from depth_pro_2.model import to_normalized_tensor
    from depth_pro_2.network.fov import FOVEstimator
    from safetensors.torch import load_file

    model = DepthPro2.from_pretrained(path, precision=torch.bfloat16)
    model.fov = FOVEstimator(torch.bfloat16)
    model.fov.load_state_dict(load_file(f"{focal_path}/model.safetensors"))
    model = model.to(DEVICE).eval()

    def estimate(image: Image.Image, query: dict) -> dict:
        image = image.convert("RGB")
        scale = min(1.0, DEPTH_LONG_SIDE / max(image.size))
        if scale < 1.0:
            image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
        focal = float(query["focal_px"]) * scale if query.get("focal_px") else None
        prediction = model.infer(to_normalized_tensor(np.array(image), DEVICE), f_px=focal)
        depth = prediction["depth"].float().cpu().numpy()
        inverse = prediction["inverse_depth"].float().cpu().numpy()
        height, width = depth.shape
        grid = [
            [
                finite_stat(depth[row * height // DEPTH_GRID : (row + 1) * height // DEPTH_GRID,
                                  column * width // DEPTH_GRID : (column + 1) * width // DEPTH_GRID], np.median)
                for column in range(DEPTH_GRID)
            ]
            for row in range(DEPTH_GRID)
        ]
        low, high = np.nanpercentile(np.where(np.isfinite(inverse), inverse, np.nan), [2, 98])
        normalized = (inverse - low) / max(high - low, 1e-6)
        return {
            "width": width,
            "height": height,
            "focalLengthPixels": round(float(prediction["focallength_px"]), 1),
            "nearestMetres": finite_stat(depth, np.min),
            "medianMetres": finite_stat(depth, np.median),
            "farthestMetres": finite_stat(depth, np.max),
            "centreMetres": finite_stat(depth[height * 3 // 8 : height * 5 // 8, width * 3 // 8 : width * 5 // 8], np.median),
            "gridMetres": grid,
            "imagePng": png_base64(turbo(np.nan_to_num(normalized, nan=0.0))),
        }

    return estimate


def load_sam3(path: str):
    """SAM 3 through transformers' Sam3Model, in float16 on the GPU; prompted by a noun phrase."""
    from transformers import Sam3Model, Sam3Processor

    processor = Sam3Processor.from_pretrained(path, local_files_only=True)
    model = Sam3Model.from_pretrained(path, dtype=torch.float16, local_files_only=True).to(DEVICE).eval()

    def segment(image: Image.Image, query: dict) -> dict:
        prompt = (query.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("say what to find, e.g. prompt=person")
        threshold = min(max(float(query.get("threshold") or 0.5), THRESHOLD_FLOOR), 1.0)
        rgb = image.convert("RGB")
        inputs = processor(images=rgb, text=prompt, return_tensors="pt").to(DEVICE)
        inputs["pixel_values"] = inputs["pixel_values"].to(torch.float16)
        with torch.inference_mode():
            outputs = model(**inputs)
        result = processor.post_process_instance_segmentation(
            outputs, threshold=threshold, mask_threshold=0.5, target_sizes=inputs["original_sizes"].tolist()
        )[0]
        width, height = rgb.size
        overlay = np.asarray(rgb).astype(np.float32)
        instances = []
        masks = result["masks"].cpu().numpy().astype(bool)
        found = sorted(zip(masks, result["boxes"].tolist(), result["scores"].tolist()), key=lambda found: -found[2])
        found = found[:MAXIMUM_INSTANCES]
        for index, (mask, box, score) in enumerate(found):
            colour = np.array(INSTANCE_COLOURS[index % len(INSTANCE_COLOURS)], np.float32)
            overlay[mask] = overlay[mask] * 0.45 + colour * 0.55
            left, top, right, bottom = box
            instances.append({
                "score": round(score, 3),
                "box": [round(left / width, 4), round(top / height, 4), round(right / width, 4), round(bottom / height, 4)],
                "areaFraction": round(float(mask.mean()), 4),
            })
        if query.get("overlay") == "1":
            picture = instance_overlay([mask for mask, _, _ in found], height, width)
        else:
            picture = overlay.astype(np.uint8)
        return {
            "width": width,
            "height": height,
            "prompt": prompt,
            "instances": instances,
            "imagePng": png_base64(picture),
        }

    return segment


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=["depth-pro-2", "sam3"], required=True)
    parser.add_argument("--path", required=True)
    parser.add_argument("--focal-path")
    parser.add_argument("--port", type=int, required=True)
    arguments = parser.parse_args()
    if arguments.model == "depth-pro-2":
        run, route = load_depth_pro_2(arguments.path, arguments.focal_path), "/v1/depth"
    else:
        run, route = load_sam3(arguments.path), "/v1/segment"
    # One request at a time on the GPU; others wait their turn.
    gpu = Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            status = {"status": "ok", "model": arguments.model, "device": DEVICE.type}
            if DEVICE.type == "mps":
                status["gpuBytes"] = torch.mps.driver_allocated_memory()
            self.reply(200, status)

        def do_POST(self):
            url = urlparse(self.path)
            if url.path != route:
                self.reply(404, {"error": f"this engine serves {route}"})
                return
            query = {key: values[0] for key, values in parse_qs(url.query).items()}
            body = self.rfile.read(int(self.headers.get("content-length") or 0))
            try:
                image = Image.open(io.BytesIO(body))
                started = time.perf_counter()
                with gpu:
                    result = run(image, query)
                    if DEVICE.type == "mps":
                        torch.mps.synchronize()
                result["milliseconds"] = round((time.perf_counter() - started) * 1000)
                self.reply(200, result)
            except ValueError as error:
                self.reply(400, {"error": str(error)})
            except Exception as error:  # reported to Studio as a failed request
                self.reply(500, {"error": f"{type(error).__name__}: {error}"})

    print(f"listening on 127.0.0.1:{arguments.port} ({arguments.model} on {DEVICE.type})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", arguments.port), Handler).serve_forever()


if __name__ == "__main__":
    sys.exit(main())
