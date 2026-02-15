#!/usr/bin/env python3
import sys
import json
import os
import time
import argparse
import tempfile
import contextlib

from PIL import Image


def _prepare_cache_env() -> None:
    paddle_home = (
        str(os.environ.get("PADDLEOCR_HOME") or "").strip()
        or str(os.environ.get("PPOCR_HOME") or "").strip()
        or "/tmp/freemannotes-paddleocr"
    )
    os.environ["PADDLEOCR_HOME"] = paddle_home
    os.environ.setdefault("PPOCR_HOME", paddle_home)
    os.environ.setdefault("PADDLE_HOME", paddle_home)

    home = str(os.environ.get("HOME") or "").strip()
    if (not home) or (home == "/"):
        home = os.path.join(paddle_home, "home")
        os.environ["HOME"] = home

    xdg_cache = str(os.environ.get("XDG_CACHE_HOME") or "").strip() or os.path.join(paddle_home, "cache")
    os.environ["XDG_CACHE_HOME"] = xdg_cache

    for p in (paddle_home, home, xdg_cache):
        try:
            os.makedirs(p, exist_ok=True)
        except Exception:
            pass


_prepare_cache_env()

try:
    from paddleocr import PaddleOCR
except Exception as e:
    sys.stderr.write("Failed to import PaddleOCR: %s\n" % str(e))
    sys.exit(2)


def maybe_deskew_png(input_path: str) -> str:
    """Best-effort deskew using OpenCV if installed.

    Returns a path to a PNG (possibly the original path).
    """
    try:
        import cv2
        import numpy as np
    except Exception:
        return input_path

    try:
        img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
        if img is None:
            return input_path

        if len(img.shape) == 3 and img.shape[2] == 4:
            # BGRA -> BGR with white background
            alpha = img[:, :, 3] / 255.0
            bgr = img[:, :, :3]
            white = np.ones_like(bgr, dtype=np.uint8) * 255
            img = (bgr * alpha[..., None] + white * (1.0 - alpha[..., None])).astype(np.uint8)

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
        blur = cv2.GaussianBlur(gray, (3, 3), 0)
        _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        coords = cv2.findNonZero(bw)
        if coords is None:
            return input_path

        rect = cv2.minAreaRect(coords)
        angle = rect[-1]
        # minAreaRect angle is in [-90, 0)
        if angle < -45:
            angle = 90 + angle
        # Only correct small/moderate skew
        if abs(angle) < 0.5 or abs(angle) > 30:
            return input_path

        (h, w) = gray.shape[:2]
        center = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        rotated = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))

        fd, out_path = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        cv2.imwrite(out_path, rotated)
        return out_path
    except Exception:
        return input_path


def preprocess_image(input_path: str) -> str:
    """Minimal preprocessing safety net.

    Node.js already does preprocessing; this is a fail-safe for odd inputs.
    """
    img = Image.open(input_path)
    if img.mode in ("RGBA", "LA"):
        img = img.convert("RGB")
    elif img.mode != "RGB":
        img = img.convert("RGB")

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".png")
    os.close(tmp_fd)
    img.save(tmp_path, format="PNG")
    return tmp_path


def run_ocr(img_path: str, lang: str):
    # PaddleOCR may print model download/progress logs to stdout.
    # The Node runner expects stdout to be valid JSON, so redirect any
    # third-party stdout noise to stderr.
    with contextlib.redirect_stdout(sys.stderr):
        ocr = PaddleOCR(lang=lang, use_angle_cls=True)

    pre_path = preprocess_image(img_path)
    deskew_path = None
    try:
        deskew_path = maybe_deskew_png(pre_path)
        with contextlib.redirect_stdout(sys.stderr):
            t0 = time.time()
            result = ocr.ocr(deskew_path, cls=True)
            dt = time.time() - t0
    finally:
        try:
            if deskew_path and deskew_path != pre_path:
                os.remove(deskew_path)
        except Exception:
            pass
        try:
            os.remove(pre_path)
        except Exception:
            pass

    lines = []
    full_text_parts = []

    if isinstance(result, list):
        for page in result:
            if isinstance(page, list):
                for det in page:
                    if isinstance(det, (list, tuple)) and len(det) >= 2:
                        box = det[0]
                        info = det[1]
                        if isinstance(info, (list, tuple)) and len(info) >= 2:
                            text = str(info[0])
                            conf = float(info[1])
                            if text.strip():
                                lines.append({"text": text, "confidence": conf, "box": box})
                                full_text_parts.append(text)

    full_text = "\n".join(full_text_parts).strip()
    avg_conf = 0.0
    if lines:
        avg_conf = sum([l.get("confidence", 0.0) for l in lines]) / float(len(lines))

    # Single-block output for now (keeps schema stable; can add layout grouping later)
    blocks = [{"lines": lines}]

    return {
        "text": full_text,
        "lines": lines,
        "blocks": blocks,
        "avgConfidence": avg_conf,
        "durationMs": int(dt * 1000),
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--image', required=True)
    p.add_argument('--lang', default='en')
    args = p.parse_args()

    img_path = args.image
    lang = str(args.lang or 'en').strip() or 'en'

    if not os.path.exists(img_path):
        sys.stderr.write("Image not found: %s\n" % img_path)
        sys.exit(1)

    try:
        res = run_ocr(img_path, lang)
        sys.stdout.write(json.dumps(res, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except Exception as e:
        sys.stderr.write("OCR error: %s\n" % str(e))
        sys.exit(3)


if __name__ == "__main__":
    main()
