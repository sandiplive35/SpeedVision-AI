export type ScreenName =
  | 'home'
  | 'detect'
  | 'calibration'
  | 'camera'
  | 'upload'
  | 'cctv'
  | 'processing'
  | 'result'
  | 'records'
  | 'settings';

export type ViolationType =
  | 'overspeeding'
  | 'wrong_way'
  | 'red_light'
  | 'no_helmet'
  | 'triple_riding'
  | 'none';

export type ReviewStatus =
  | 'needs_review'
  | 'confirmed'
  | 'clear'
  | 'incorrect'
  | 'plate_unreadable'
  | 'demo';

export type TrafficDirection = 'left_to_right' | 'right_to_left' | 'both';
export type SpeedUnit = 'kmh' | 'mph';

export interface AnalysisRequestSettings {
  calibrationDistanceM: number;
  speedLimitKmh: number;
  country: string;
  speedUnit: SpeedUnit;
  trafficDirection: TrafficDirection;
  plateProfile: 'automatic' | 'selected';
  blurPlatesOnShare: boolean;
  saveOriginalVideo: boolean;
  saveEvidenceFrames: boolean;
}

export interface VehicleDetection {
  id: string;
  vehicleType: string;
  plateText: string | null;
  speedKmh: number | null;
  confidence: number;
  plateConfidence: number | null;
  violation: ViolationType;
  reviewStatus: ReviewStatus;
  capturedAt: string;
  sourceName?: string;
  expectedErrorKmh?: number;
}

export interface AnalysisResponse {
  jobId: string;
  mode: 'live' | 'upload' | 'demo';
  status: 'complete' | 'partial' | 'failed';
  detections: VehicleDetection[];
  processingMs: number;
  message?: string;
}

export interface PersistedAppState {
  onboardingCompleted: boolean;
  settings: AnalysisRequestSettings;
  history: VehicleDetection[];
  workspaceName: string;
}

export interface CctvCredentials {
  name: string;
  url: string;
  username: string;
  password: string;
}
