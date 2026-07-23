import type { AnalysisRequestSettings, AnalysisResponse } from './types';

const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export const isBackendConfigured = Boolean(API_URL);

export async function analyzeVideo(
  uri: string,
  settings: AnalysisRequestSettings,
): Promise<AnalysisResponse> {
  if (!API_URL) {
    return createDemoResponse(settings);
  }

  const form = new FormData();
  form.append('video', {
    uri,
    name: 'traffic-video.mp4',
    type: 'video/mp4',
  } as unknown as Blob);
  form.append('calibration_distance_m', String(settings.calibrationDistanceM));
  form.append('speed_limit_kmh', String(settings.speedLimitKmh));

  const response = await fetch(`${API_URL}/analyze`, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Analysis failed with status ${response.status}`);
  }

  return (await response.json()) as AnalysisResponse;
}

export function createDemoResponse(settings: AnalysisRequestSettings): AnalysisResponse {
  const speedKmh = settings.speedLimitKmh + 18;

  return {
    jobId: `demo-${Date.now()}`,
    mode: 'demo',
    status: 'complete',
    processingMs: 820,
    message: 'Demo result — connect the FastAPI backend for real video analysis.',
    detections: [
      {
        id: 'vehicle-demo-1',
        vehicleType: 'Car',
        plateText: 'WB 24 AB 1234',
        speedKmh,
        confidence: 0.94,
        plateConfidence: 0.89,
        violation: 'overspeeding',
        reviewStatus: 'demo',
        capturedAt: new Date().toISOString(),
      },
    ],
  };
}
