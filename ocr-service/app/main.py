import asyncio
import hmac
import io
import logging
import math
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from PIL import Image

app = FastAPI(title="Pharmacy PaddleOCR service", version="1.0.0")
logger = logging.getLogger("paddleocr-service")
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff"}
ALLOWED_TYPES = ALLOWED_IMAGE_TYPES | {"application/pdf"}
MIME_SUFFIXES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "application/pdf": ".pdf",
}
ocr_instance: Any | None = None
ocr_init_lock = threading.Lock()
ocr_inference_lock = threading.Lock()


def get_ocr() -> Any:
    global ocr_instance
    if ocr_instance is None:
        with ocr_init_lock:
            if ocr_instance is None:
                from paddleocr import PaddleOCR

                ocr_instance = PaddleOCR(
                    lang=os.getenv("OCR_LANG", "en"),
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                )
    return ocr_instance


def run_ocr(input_path: Path) -> Any:
    with ocr_inference_lock:
        return get_ocr().predict(input=str(input_path))


def validate_file(content: bytes, content_type: str) -> None:
    if content_type == "application/pdf":
        if not content.startswith(b"%PDF-"):
            raise HTTPException(status_code=400, detail="The uploaded file is not a valid PDF.")
        return

    try:
        with Image.open(io.BytesIO(content)) as image:
            image.verify()
            if image.format not in {"JPEG", "PNG", "WEBP", "BMP", "TIFF"}:
                raise HTTPException(status_code=415, detail="This image format is not supported.")
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=400, detail="The uploaded image is invalid or damaged.") from error


def serialize_results(results: Any) -> dict[str, Any]:
    pages = []
    all_text = []
    for page_number, result in enumerate(results, start=1):
        raw = getattr(result, "json", None)
        if not isinstance(raw, dict):
            raise ValueError("PaddleOCR returned an unsupported result format.")
        payload = raw.get("res", raw)
        texts = payload.get("rec_texts", [])
        scores = payload.get("rec_scores", [])
        if hasattr(texts, "tolist"):
            texts = texts.tolist()
        if hasattr(scores, "tolist"):
            scores = scores.tolist()
        if not isinstance(texts, list) or not isinstance(scores, list):
            raise ValueError("PaddleOCR returned invalid recognized text.")

        lines = []
        for index, text in enumerate(texts):
            if not isinstance(text, str):
                continue
            confidence = None
            if index < len(scores):
                try:
                    confidence = float(scores[index])
                    if not math.isfinite(confidence):
                        confidence = None
                except (TypeError, ValueError):
                    confidence = None
            lines.append({"text": text, "confidence": confidence})
            if text.strip():
                all_text.append(text)
        pages.append({"page": page_number, "lines": lines})
    return {"text": "\n".join(all_text), "pages": pages}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/ocr/recognize")
async def recognize(
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    expected_key = os.getenv("PADDLEOCR_API_KEY", "")
    provided_key = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not expected_key:
        raise HTTPException(status_code=503, detail="PaddleOCR service authentication is not configured.")
    if not hmac.compare_digest(provided_key, expected_key):
        raise HTTPException(status_code=401, detail="Invalid OCR service credentials.")

    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Choose a JPEG, PNG, WEBP, BMP, TIFF, or PDF file.")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The selected file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The selected file exceeds the 10 MB limit.")
    validate_file(content, content_type)

    try:
        with tempfile.TemporaryDirectory(prefix="pharmacy-ocr-") as temp_dir:
            input_path = Path(temp_dir) / f"upload{MIME_SUFFIXES[content_type]}"
            input_path.write_bytes(content)
            results = await asyncio.to_thread(run_ocr, input_path)
            return serialize_results(results)
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("PaddleOCR failed to process an uploaded file.")
        raise HTTPException(status_code=500, detail="PaddleOCR could not process this file. Check the OCR service logs.") from error
