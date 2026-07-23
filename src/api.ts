import type { AnalysisRequestSettings, AnalysisResponse } from './types';

const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export const isBackendConfigured = Boolean(API_URL);

export async function analyzeVideo(
  uri: string,
  settings: AnalysisRequestSettings,
): Promise<AnalysisResponse> {
  if (!API_URL) {
    await new Promise((resolve) => setTimeout(resolve, 1100));
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
  form.append('country', settings.country);
  form.append('traffic_direction', settings.trafficDirection);
  form.append('plate_profile', settings.plateProfile);

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
  const plateByCountry: Record<string, string> = {
    India: 'MH 12 AB 1234',
    'United States': 'SVN 2048',
    'United Kingdom': 'SV24 AI1',
    Germany: 'SV AI 2048',
    'United Arab Emirates': 'B 20481',
  };

  return {
    jobId: `demo-${Date.now()}`,
    mode: 'demo',
    status: 'complete',
    processingMs: 1100,
    message: 'Demo result — connect the FastAPI backend for real video analysis.',
    detections: [
      {
        id: `vehicle-demo-${Date.now()}`,
        vehicleType: 'Car',
        plateText: plateByCountry[settings.country] ?? 'SV 2048',
        speedKmh,
        confidence: 0.94,
        plateConfidence: 0.89,
        violation: 'overspeeding',
        reviewStatus: 'demo',
        capturedAt: new Date().toISOString(),
        sourceName: 'Demo traffic video',
        expectedErrorKmh: 4,
      },
    ],
  };
}
