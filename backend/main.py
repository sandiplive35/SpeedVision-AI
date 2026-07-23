from __future__ import annotations

import re
import shutil
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import easyocr
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO

app = FastAPI(title="SpeedVision AI API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

VEHICLE_CLASS_NAMES = {"car", "motorcycle", "bus", "truck"}
PLATE_PATTERN = re.compile(r"[^A-Z0-9]")

_model: YOLO | None = None
_ocr: easyocr.Reader | None = None


@dataclass
class CrossingState:
    first_line_frame: int | None = None
    second_line_frame: int | None = None
    last_x: float | None = None
    class_name: str = "Vehicle"
    confidence: float = 0.0
    best_crop: Any | None = None


def get_model() -> YOLO:
    global _model
    if _model is None:
        _model = YOLO("yolo11n.pt")
    return _model


def get_ocr() -> easyocr.Reader:
    global _ocr
    if _ocr is None:
        _ocr = easyocr.Reader(["en"], gpu=False)
    return _ocr


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "speedvision-ai"}


@app.post("/analyze")
async def analyze(
    video: UploadFile = File(...),
    calibration_distance_m: float = Form(10.0),
    speed_limit_kmh: float = Form(50.0),
) -> dict[str, Any]:
    if calibration_distance_m <= 0:
        raise HTTPException(status_code=400, detail="Calibration distance must be positive")
    if speed_limit_kmh <= 0:
        raise HTTPException(status_code=400, detail="Speed limit must be positive")

    suffix = Path(video.filename or "traffic.mp4").suffix or ".mp4"
    started = time.perf_counter()

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
        shutil.copyfileobj(video.file, temp_file)
        path = Path(temp_file.name)

    try:
        detections = analyze_video(path, calibration_distance_m, speed_limit_kmh)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Video analysis failed: {exc}") from exc
    finally:
        path.unlink(missing_ok=True)

    processing_ms = int((time.perf_counter() - started) * 1000)
    return {
        "jobId": str(uuid.uuid4()),
        "mode": "upload",
        "status": "complete" if detections else "partial",
        "processingMs": processing_ms,
        "message": (
            "Prototype result. Plate OCR uses the lower vehicle crop until a dedicated "
            "number-plate detector is added."
        ),
        "detections": detections,
    }


def analyze_video(
    path: Path,
    calibration_distance_m: float,
    speed_limit_kmh: float,
) -> list[dict[str, Any]]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError("The uploaded file could not be opened as a video")

    fps = capture.get(cv2.CAP_PROP_FPS)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    if fps <= 0 or width <= 0:
        capture.release()
        raise ValueError("Video metadata is missing FPS or frame width")

    line_a = width * 0.35
    line_b = width * 0.65
    tracks: dict[int, CrossingState] = {}
    frame_index = 0
    model = get_model()

    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break

            # Process every second frame for an affordable mobile-MVP backend.
            if frame_index % 2 != 0:
                frame_index += 1
                continue

            results = model.track(
                source=frame,
                persist=True,
                verbose=False,
                classes=[2, 3, 5, 7],  # COCO: car, motorcycle, bus, truck
                conf=0.35,
            )

            result = results[0]
            if result.boxes is None or result.boxes.id is None:
                frame_index += 1
                continue

            boxes = result.boxes.xyxy.cpu().numpy()
            ids = result.boxes.id.int().cpu().tolist()
            classes = result.boxes.cls.int().cpu().tolist()
            confidences = result.boxes.conf.cpu().tolist()

            for box, track_id, class_id, confidence in zip(
                boxes, ids, classes, confidences, strict=True
            ):
                class_name = model.names.get(class_id, "vehicle")
                if class_name not in VEHICLE_CLASS_NAMES:
                    continue

                x1, y1, x2, y2 = (int(value) for value in box)
                center_x = (x1 + x2) / 2
                state = tracks.setdefault(track_id, CrossingState())
                state.class_name = class_name.title()
                state.confidence = max(state.confidence, float(confidence))

                crop = frame[max(y1, 0) : max(y2, 0), max(x1, 0) : max(x2, 0)]
                if crop.size and (
                    state.best_crop is None
                    or crop.shape[0] * crop.shape[1]
                    > state.best_crop.shape[0] * state.best_crop.shape[1]
                ):
                    state.best_crop = crop.copy()

                if state.last_x is not None:
                    crossed_a = (state.last_x < line_a <= center_x) or (
                        state.last_x > line_a >= center_x
                    )
                    crossed_b = (state.last_x < line_b <= center_x) or (
                        state.last_x > line_b >= center_x
                    )
                    moving_right = center_x > state.last_x

                    if moving_right:
                        if crossed_a and state.first_line_frame is None:
                            state.first_line_frame = frame_index
                        elif crossed_b and state.first_line_frame is not None:
                            state.second_line_frame = frame_index
                    else:
                        if crossed_b and state.first_line_frame is None:
                            state.first_line_frame = frame_index
                        elif crossed_a and state.first_line_frame is not None:
                            state.second_line_frame = frame_index

                state.last_x = center_x

            frame_index += 1
    finally:
        capture.release()

    output: list[dict[str, Any]] = []
    for track_id, state in tracks.items():
        if state.first_line_frame is None or state.second_line_frame is None:
            continue

        elapsed_seconds = abs(state.second_line_frame - state.first_line_frame) / fps
        if elapsed_seconds <= 0:
            continue

        speed_kmh = (calibration_distance_m / elapsed_seconds) * 3.6
        if speed_kmh <= 1 or speed_kmh > 300:
            continue

        plate_text, plate_confidence = read_plate_from_vehicle_crop(state.best_crop)
        violation = "overspeeding" if speed_kmh > speed_limit_kmh else "none"

        output.append(
            {
                "id": f"track-{track_id}",
                "vehicleType": state.class_name,
                "plateText": plate_text,
                "speedKmh": round(speed_kmh, 1),
                "confidence": round(state.confidence, 3),
                "plateConfidence": plate_confidence,
                "violation": violation,
                "reviewStatus": "needs_review" if violation != "none" else "clear",
                "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        )

    return sorted(output, key=lambda item: item["speedKmh"], reverse=True)


def read_plate_from_vehicle_crop(crop: Any | None) -> tuple[str | None, float | None]:
    if crop is None or crop.size == 0:
        return None, None

    height = crop.shape[0]
    lower_crop = crop[int(height * 0.48) :, :]
    gray = cv2.cvtColor(lower_crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 9, 75, 75)

    candidates = get_ocr().readtext(gray)
    best_text: str | None = None
    best_confidence = 0.0

    for _, raw_text, confidence in candidates:
        normalized = PLATE_PATTERN.sub("", raw_text.upper())
        if 6 <= len(normalized) <= 12 and confidence > best_confidence:
            best_text = normalized
            best_confidence = float(confidence)

    return best_text, round(best_confidence, 3) if best_text else None
