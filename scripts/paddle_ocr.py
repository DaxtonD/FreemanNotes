#!/usr/bin/env python3
import sys
import json
import os
import time
import tempfile
from PIL import Image

try:
    from paddleocr import PaddleOCR
except Exception as e:
    sys.stderr.write("Failed to import PaddleOCR: %s\n" % str(e))
    sys.exit(2)

# Preprocess: convert to RGB, drop alpha, resize max dim ~1800px
MAX_DIM = 1800


def preprocess_image(input_path):
    img = Image.open(input_path)
    # Convert to RGB (remove alpha if present)
    if img.mode in ("RGBA", "LA"):
        img = img.convert("RGB")
    elif img.mode != "RGB":
        img = img.convert("RGB")
    # Resize preserving aspect ratio so max dimension ~ MAX_DIM
    w, h = img.size
    max_side = max(w, h)
    if max_side > MAX_DIM:
        scale = MAX_DIM / float(max_side)
        new_w = max(1, int(w * scale))
        new_h = max(1, int(h * scale))
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    # Save to a temp file for PaddleOCR to read
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".png")
    os.close(tmp_fd)
    img.save(tmp_path, format="PNG")
    return tmp_path


def run_ocr(img_path):
    ocr = PaddleOCR(lang='en', use_angle_cls=True)
    # Preprocess first
    pre_path = preprocess_image(img_path)
    try:
        t0 = time.time()
        # Run OCR once, no retries
        result = ocr.ocr(pre_path, cls=True)
        dt = time.time() - t0
    finally:
        try:
            os.remove(pre_path)
        except Exception:
            pass
    # Parse results
    lines = []
    full_text_parts = []
    # result can be list of pages; typically single image => list with one item
    if isinstance(result, list):
        for page in result:
            # page: list of detections: [ [box], (text, conf) ]
            if isinstance(page, list):
                for det in page:
                    if isinstance(det, (list, tuple)) and len(det) >= 2:
                        info = det[1]
                        if isinstance(info, (list, tuple)) and len(info) >= 2:
                            text = str(info[0])
                            conf = float(info[1])
                            if text.strip():
                                lines.append({"text": text, "confidence": conf})
                                full_text_parts.append(text)
    full_text = "\n".join(full_text_parts).strip()
    avg_conf = 0.0
    if lines:
        avg_conf = sum([l["confidence"] for l in lines]) / float(len(lines))
    out = {
        "text": full_text,
        "lines": lines,
        "avgConfidence": avg_conf,
        "durationMs": int(dt * 1000)
    }
    return out


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: paddle_ocr.py <image_path>\n")
        sys.exit(1)
    img_path = sys.argv[1]
    if not os.path.exists(img_path):
        sys.stderr.write("Image not found: %s\n" % img_path)
        sys.exit(1)
    try:
        res = run_ocr(img_path)
        print(json.dumps(res, ensure_ascii=False))
    except Exception as e:
        sys.stderr.write("OCR error: %s\n" % str(e))
        sys.exit(3)


if __name__ == "__main__":
    main()
