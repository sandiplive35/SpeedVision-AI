export type ScreenName = 'home' | 'camera' | 'result' | 'history' | 'settings';

export type ViolationType =
  | 'overspeeding'
  | 'wrong_way'
  | 'red_light'
  | 'no_helmet'
  | 'triple_riding'
  | 'none';

export interface AnalysisRequestSettings {
  calibrationDistanceM: number;
  speedLimitKmh: number;
}

export interface VehicleDetection {
  id: string;
  vehicleType: string;
  plateText: string | null;
  speedKmh: number | null;
  confidence: number;
  plateConfidence: number | null;
  violation: ViolationType;
  reviewStatus: 'needs_review' | 'clear' | 'demo';
  capturedAt: string;
}

export interface AnalysisResponse {
  jobId: string;
  mode: 'live' | 'upload' | 'demo';
  status: 'complete' | 'partial' | 'failed';
  detections: VehicleDetection[];
  processingMs: number;
  message?: string;
}
