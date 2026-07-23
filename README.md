# SpeedVision AI

A mobile-first traffic camera MVP that can:

- Record or upload road video
- Measure vehicle speed from calibrated line crossings
- Read number plates with OCR
- Flag suspected overspeeding for human review
- Display results in a clean black-and-white interface

> This repository is an MVP, not an authorized enforcement or automatic-challan system. All suspected violations require human review.

## Project structure

```text
SpeedVision-AI/
├── App.tsx                 # Expo mobile app
├── src/                    # Shared types and API client
└── backend/                # FastAPI + OpenCV/YOLO analysis service
```

## Mobile app

Requirements: Node.js 22.13+ and a compatible Expo Go app.

```bash
npm install
npx expo start
```

Set the backend address before testing real analysis:

```bash
EXPO_PUBLIC_API_URL=http://YOUR_COMPUTER_IP:8000 npx expo start
```

Without a backend URL, the interface remains usable and analysis results are clearly labelled as demo data.

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The first model run may download YOLO weights. For reliable number-plate OCR, replace the prototype vehicle-crop OCR with a dedicated plate-detection model.

## Calibration

The MVP uses two virtual crossing lines and a user-entered real distance between them. The camera must remain stationary. Speed is calculated from:

```text
speed = calibrated distance / crossing time
```

## Current scope

Implemented foundation:

- Minimal black-and-white mobile UI
- Camera recording and video upload
- Backend upload API
- Vehicle detection and tracking pipeline
- Calibrated line-crossing speed calculation
- Prototype plate OCR
- Overspeed violation flagging
- Human-review status

Planned next:

- On-screen draggable calibration lines
- Dedicated Indian number-plate detector
- Helmet, triple-riding, wrong-way and red-light custom models
- Secure local history/database
- Evidence export and privacy controls
