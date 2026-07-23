# SpeedVision backend

The API accepts a video and two numeric settings:

- `calibration_distance_m`
- `speed_limit_kmh`

## Endpoint

```text
POST /analyze
Content-Type: multipart/form-data
```

The current prototype uses YOLO tracking, two fixed virtual line positions (35% and 65% of frame width), calibrated distance, and OCR on the lower vehicle crop.

## Important limitations

- The camera must be stationary.
- The vehicle must cross both virtual lines.
- Perspective calibration is not yet implemented.
- Plate OCR is provisional until a dedicated plate detector is added.
- Helmet, red-light, wrong-way and triple-riding detection need separately trained models.
- Results are review alerts, not legal determinations.
