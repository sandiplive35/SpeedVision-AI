import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from 'react-native-safe-area-context';

import { analyzeVideo, isBackendConfigured } from './src/api';
import type {
  AnalysisRequestSettings,
  AnalysisResponse,
  ScreenName,
  VehicleDetection,
} from './src/types';

const COLORS = {
  background: '#050505',
  surface: '#0D0D0D',
  surfaceRaised: '#151515',
  white: '#FFFFFF',
  text: '#F5F5F5',
  muted: '#8B8B8B',
  border: '#252525',
  borderStrong: '#3B3B3B',
} as const;

const DEFAULT_SETTINGS: AnalysisRequestSettings = {
  calibrationDistanceM: 10,
  speedLimitKmh: 50,
};

const SEED_HISTORY: VehicleDetection[] = [
  {
    id: 'seed-1',
    vehicleType: 'Car',
    plateText: 'WB 24 AB 1234',
    speedKmh: 68,
    confidence: 0.94,
    plateConfidence: 0.89,
    violation: 'overspeeding',
    reviewStatus: 'demo',
    capturedAt: new Date().toISOString(),
  },
  {
    id: 'seed-2',
    vehicleType: 'Motorcycle',
    plateText: 'WB 18 P 8041',
    speedKmh: 43,
    confidence: 0.91,
    plateConfidence: 0.86,
    violation: 'none',
    reviewStatus: 'demo',
    capturedAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
  },
];

export default function App() {
  const [screen, setScreen] = useState<ScreenName>('home');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [history, setHistory] = useState<VehicleDetection[]>(SEED_HISTORY);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const navigate = (next: ScreenName) => {
    void Haptics.selectionAsync();
    setScreen(next);
  };

  const runAnalysis = async (uri: string) => {
    setIsAnalyzing(true);
    try {
      const response = await analyzeVideo(uri, settings);
      setAnalysis(response);
      setHistory((current) => [...response.detections, ...current]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setScreen('result');
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message = error instanceof Error ? error.message : 'Unknown analysis error';
      Alert.alert('Analysis failed', message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const uploadVideo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      quality: 1,
      videoMaxDuration: 60,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      await runAnalysis(result.assets[0].uri);
    }
  };

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="light" backgroundColor={COLORS.background} />
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.app}>
          {screen === 'home' && (
            <HomeScreen
              history={history}
              settings={settings}
              isAnalyzing={isAnalyzing}
              onCamera={() => navigate('camera')}
              onUpload={() => void uploadVideo()}
              onResult={() => analysis && navigate('result')}
            />
          )}
          {screen === 'camera' && (
            <CameraScreen
              settings={settings}
              isAnalyzing={isAnalyzing}
              onClose={() => navigate('home')}
              onRecorded={(uri) => void runAnalysis(uri)}
            />
          )}
          {screen === 'result' && (
            <ResultScreen
              analysis={analysis}
              speedLimit={settings.speedLimitKmh}
              onBack={() => navigate('home')}
            />
          )}
          {screen === 'history' && <HistoryScreen history={history} />}
          {screen === 'settings' && (
            <SettingsScreen settings={settings} onChange={setSettings} />
          )}

          {screen !== 'camera' && (
            <BottomNavigation screen={screen} onNavigate={navigate} />
          )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

interface HomeScreenProps {
  history: VehicleDetection[];
  settings: AnalysisRequestSettings;
  isAnalyzing: boolean;
  onCamera: () => void;
  onUpload: () => void;
  onResult: () => void;
}

function HomeScreen({
  history,
  settings,
  isAnalyzing,
  onCamera,
  onUpload,
  onResult,
}: HomeScreenProps) {
  const today = useMemo(() => history.slice(0, 12), [history]);
  const violations = today.filter((item) => item.violation !== 'none').length;
  const platesRead = today.filter((item) => item.plateText).length;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.pageContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>SPEEDVISION AI</Text>
          <Text style={styles.pageTitle}>Traffic intelligence.</Text>
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveBadgeText}>{isBackendConfigured ? 'API LIVE' : 'DEMO'}</Text>
        </View>
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>CURRENT SPEED LIMIT</Text>
        <View style={styles.speedRow}>
          <Text style={styles.heroSpeed}>{settings.speedLimitKmh}</Text>
          <Text style={styles.heroUnit}>km/h</Text>
        </View>
        <Text style={styles.heroCaption}>
          Stationary camera · {settings.calibrationDistanceM} m calibration
        </Text>

        <Pressable style={styles.primaryButton} onPress={onCamera}>
          <Text style={styles.primaryButtonText}>Open live camera</Text>
          <Text style={styles.primaryButtonArrow}>→</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          onPress={onUpload}
          disabled={isAnalyzing}
        >
          {isAnalyzing ? (
            <ActivityIndicator color={COLORS.background} />
          ) : (
            <>
              <Text style={styles.secondaryButtonText}>Upload traffic video</Text>
              <Text style={styles.secondaryButtonArrow}>＋</Text>
            </>
          )}
        </Pressable>
      </View>

      <View style={styles.sectionHeadingRow}>
        <Text style={styles.sectionTitle}>Today</Text>
        <Text style={styles.sectionMeta}>{today.length} detections</Text>
      </View>

      <View style={styles.metricGrid}>
        <MetricCard label="Vehicles" value={String(today.length)} />
        <MetricCard label="Violations" value={String(violations)} />
        <MetricCard label="Plates read" value={String(platesRead)} />
      </View>

      <View style={styles.sectionHeadingRow}>
        <Text style={styles.sectionTitle}>Recent detections</Text>
        <Pressable onPress={onResult} disabled={!history.length}>
          <Text style={styles.textLink}>View latest</Text>
        </Pressable>
      </View>

      <View style={styles.listCard}>
        {history.slice(0, 3).map((item, index) => (
          <DetectionRow
            key={item.id}
            detection={item}
            showDivider={index < Math.min(history.length, 3) - 1}
          />
        ))}
      </View>

      {!isBackendConfigured && (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>Demo mode is active</Text>
          <Text style={styles.noticeText}>
            Connect EXPO_PUBLIC_API_URL to run real video analysis. Demo data is never
            presented as legal evidence.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

interface CameraScreenProps {
  settings: AnalysisRequestSettings;
  isAnalyzing: boolean;
  onClose: () => void;
  onRecorded: (uri: string) => void;
}

function CameraScreen({ settings, isAnalyzing, onClose, onRecorded }: CameraScreenProps) {
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);

  const startRecording = async () => {
    if (!cameraReady || recording || !cameraRef.current) return;

    setRecording(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: 30 });
      if (video?.uri) onRecorded(video.uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not record video';
      Alert.alert('Camera error', message);
    } finally {
      setRecording(false);
    }
  };

  const stopRecording = () => {
    cameraRef.current?.stopRecording();
  };

  if (!permission) {
    return <View style={styles.cameraFallback} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionScreen}>
        <Text style={styles.eyebrow}>CAMERA ACCESS</Text>
        <Text style={styles.permissionTitle}>Camera permission is required.</Text>
        <Text style={styles.permissionText}>
          Video stays on the device until you choose to analyze it.
        </Text>
        <Pressable style={styles.primaryButton} onPress={() => void requestPermission()}>
          <Text style={styles.primaryButtonText}>Allow camera</Text>
          <Text style={styles.primaryButtonArrow}>→</Text>
        </Pressable>
        <Pressable style={styles.closeTextButton} onPress={onClose}>
          <Text style={styles.closeText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode="video"
        videoQuality="1080p"
        onCameraReady={() => setCameraReady(true)}
      />
      <View style={styles.cameraShade} />

      <View style={styles.cameraTopBar}>
        <Pressable style={styles.roundButton} onPress={onClose}>
          <Text style={styles.roundButtonText}>×</Text>
        </Pressable>
        <View style={styles.cameraStatusPill}>
          <View style={[styles.liveDot, recording && styles.recordingDot]} />
          <Text style={styles.cameraStatusText}>{recording ? 'RECORDING' : 'READY'}</Text>
        </View>
      </View>

      <View style={styles.guideFrame}>
        <View style={[styles.guideLine, styles.guideLineA]} />
        <View style={[styles.guideLine, styles.guideLineB]} />
        <View style={[styles.lineLabel, styles.lineLabelA]}>
          <Text style={styles.lineLabelText}>A</Text>
        </View>
        <View style={[styles.lineLabel, styles.lineLabelB]}>
          <Text style={styles.lineLabelText}>B</Text>
        </View>
      </View>

      <View style={styles.cameraReadout}>
        <View>
          <Text style={styles.cameraReadoutLabel}>CALIBRATION</Text>
          <Text style={styles.cameraReadoutValue}>{settings.calibrationDistanceM} m</Text>
        </View>
        <View style={styles.cameraReadoutRight}>
          <Text style={styles.cameraReadoutLabel}>LIMIT</Text>
          <Text style={styles.cameraReadoutValue}>{settings.speedLimitKmh} km/h</Text>
        </View>
      </View>

      <View style={styles.cameraBottomBar}>
        <Text style={styles.cameraHint}>Keep the phone completely still</Text>
        <Pressable
          style={[styles.shutterOuter, recording && styles.shutterOuterRecording]}
          onPress={recording ? stopRecording : () => void startRecording()}
          disabled={!cameraReady || isAnalyzing}
        >
          <View style={[styles.shutterInner, recording && styles.shutterInnerRecording]} />
        </Pressable>
        <Text style={styles.cameraHint}>{recording ? 'Tap to stop' : 'Tap to record'}</Text>
      </View>

      {isAnalyzing && (
        <View style={styles.processingOverlay}>
          <ActivityIndicator size="large" color={COLORS.white} />
          <Text style={styles.processingTitle}>Analyzing video</Text>
          <Text style={styles.processingText}>Tracking vehicles and reading plates…</Text>
        </View>
      )}
    </View>
  );
}

interface ResultScreenProps {
  analysis: AnalysisResponse | null;
  speedLimit: number;
  onBack: () => void;
}

function ResultScreen({ analysis, speedLimit, onBack }: ResultScreenProps) {
  const detection = analysis?.detections[0];

  if (!analysis || !detection) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.pageTitle}>No result yet.</Text>
        <Pressable style={styles.primaryButton} onPress={onBack}>
          <Text style={styles.primaryButtonText}>Return home</Text>
          <Text style={styles.primaryButtonArrow}>→</Text>
        </Pressable>
      </View>
    );
  }

  const hasViolation = detection.violation !== 'none';

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.pageContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>ANALYSIS RESULT</Text>
          <Text style={styles.pageTitle}>Vehicle detected.</Text>
        </View>
        <Pressable style={styles.roundButtonOutlined} onPress={onBack}>
          <Text style={styles.roundButtonOutlinedText}>×</Text>
        </Pressable>
      </View>

      <View style={styles.resultSpeedCard}>
        <Text style={styles.resultSpeedLabel}>MEASURED SPEED</Text>
        <View style={styles.resultSpeedRow}>
          <Text style={styles.resultSpeed}>{detection.speedKmh?.toFixed(0) ?? '—'}</Text>
          <Text style={styles.resultSpeedUnit}>km/h</Text>
        </View>
        <View style={styles.limitLine}>
          <Text style={styles.limitText}>Configured limit</Text>
          <Text style={styles.limitValue}>{speedLimit} km/h</Text>
        </View>
      </View>

      <View style={styles.plateCard}>
        <Text style={styles.fieldLabel}>NUMBER PLATE</Text>
        <Text style={styles.plateText}>{detection.plateText ?? 'NOT READ'}</Text>
        <View style={styles.confidenceRow}>
          <Text style={styles.confidenceLabel}>Plate confidence</Text>
          <Text style={styles.confidenceValue}>
            {detection.plateConfidence
              ? `${Math.round(detection.plateConfidence * 100)}%`
              : '—'}
          </Text>
        </View>
      </View>

      <View style={styles.detailGrid}>
        <DetailCell label="Vehicle" value={detection.vehicleType} />
        <DetailCell label="Detection" value={`${Math.round(detection.confidence * 100)}%`} />
        <DetailCell label="Source" value={analysis.mode.toUpperCase()} />
        <DetailCell label="Processing" value={`${analysis.processingMs} ms`} />
      </View>

      <View style={[styles.violationCard, !hasViolation && styles.clearCard]}>
        <View style={styles.violationHeader}>
          <Text style={styles.violationEyebrow}>
            {hasViolation ? 'SUSPECTED VIOLATION' : 'STATUS'}
          </Text>
          <View style={styles.reviewPill}>
            <Text style={styles.reviewPillText}>HUMAN REVIEW</Text>
          </View>
        </View>
        <Text style={[styles.violationTitle, !hasViolation && styles.clearText]}>
          {hasViolation ? formatViolation(detection.violation) : 'No configured violation found'}
        </Text>
        <Text style={[styles.violationText, !hasViolation && styles.clearMutedText]}>
          This result is an automated estimate and must be reviewed before any action is
          taken.
        </Text>
      </View>

      {analysis.message && <Text style={styles.footnote}>{analysis.message}</Text>}
    </ScrollView>
  );
}

function HistoryScreen({ history }: { history: VehicleDetection[] }) {
  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.pageContent}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.eyebrow}>HISTORY</Text>
      <Text style={styles.pageTitle}>Detection log.</Text>
      <Text style={styles.pageSubtitle}>Review automated results before using them.</Text>

      <View style={[styles.listCard, styles.historyList]}>
        {history.map((item, index) => (
          <DetectionRow
            key={`${item.id}-${index}`}
            detection={item}
            showDivider={index < history.length - 1}
          />
        ))}
      </View>
    </ScrollView>
  );
}

interface SettingsScreenProps {
  settings: AnalysisRequestSettings;
  onChange: (settings: AnalysisRequestSettings) => void;
}

function SettingsScreen({ settings, onChange }: SettingsScreenProps) {
  const [saveEvidence, setSaveEvidence] = useState(false);
  const [blurPlates, setBlurPlates] = useState(true);

  const updateNumber = (field: keyof AnalysisRequestSettings, value: string) => {
    const number = Number(value.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(number)) onChange({ ...settings, [field]: number });
  };

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.pageContent}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.eyebrow}>SETTINGS</Text>
      <Text style={styles.pageTitle}>Camera rules.</Text>
      <Text style={styles.pageSubtitle}>
        Set these values before placing the camera beside a road.
      </Text>

      <View style={styles.settingsGroup}>
        <SettingInput
          label="Speed limit"
          suffix="km/h"
          value={String(settings.speedLimitKmh)}
          onChangeText={(value) => updateNumber('speedLimitKmh', value)}
        />
        <SettingInput
          label="Line distance"
          suffix="metres"
          value={String(settings.calibrationDistanceM)}
          onChangeText={(value) => updateNumber('calibrationDistanceM', value)}
        />
      </View>

      <View style={styles.settingsGroup}>
        <SettingToggle
          label="Blur plates in exports"
          description="Keep readable plate data inside the private review view."
          value={blurPlates}
          onValueChange={setBlurPlates}
        />
        <View style={styles.settingsDivider} />
        <SettingToggle
          label="Save evidence locally"
          description="Off by default. Retention controls will be added next."
          value={saveEvidence}
          onValueChange={setSaveEvidence}
        />
      </View>

      <View style={styles.noticeCard}>
        <Text style={styles.noticeTitle}>Accuracy conditions</Text>
        <Text style={styles.noticeText}>
          Use a stationary camera, visible plates, daylight, a measured calibration distance,
          and a clear side view of traffic.
        </Text>
      </View>
    </ScrollView>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailCell}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function DetectionRow({
  detection,
  showDivider,
}: {
  detection: VehicleDetection;
  showDivider: boolean;
}) {
  const hasViolation = detection.violation !== 'none';

  return (
    <View style={[styles.detectionRow, showDivider && styles.detectionDivider]}>
      <View style={styles.detectionIcon}>
        <Text style={styles.detectionIconText}>{detection.vehicleType.charAt(0)}</Text>
      </View>
      <View style={styles.detectionInfo}>
        <Text style={styles.detectionPlate}>{detection.plateText ?? 'Plate not read'}</Text>
        <Text style={styles.detectionMeta}>
          {detection.vehicleType} · {formatTime(detection.capturedAt)}
        </Text>
      </View>
      <View style={styles.detectionRight}>
        <Text style={styles.detectionSpeed}>
          {detection.speedKmh ? `${Math.round(detection.speedKmh)}` : '—'}
        </Text>
        <Text style={styles.detectionUnit}>{hasViolation ? 'REVIEW' : 'KM/H'}</Text>
      </View>
    </View>
  );
}

function SettingInput({
  label,
  suffix,
  value,
  onChangeText,
}: {
  label: string;
  suffix: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.settingInputRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.numberInputWrap}>
        <TextInput
          style={styles.numberInput}
          value={value}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          selectTextOnFocus
        />
        <Text style={styles.inputSuffix}>{suffix}</Text>
      </View>
    </View>
  );
}

function SettingToggle({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: COLORS.borderStrong, true: COLORS.white }}
        thumbColor={value ? COLORS.background : COLORS.muted}
      />
    </View>
  );
}

function BottomNavigation({
  screen,
  onNavigate,
}: {
  screen: ScreenName;
  onNavigate: (screen: ScreenName) => void;
}) {
  const items: Array<{ key: ScreenName; label: string; glyph: string }> = [
    { key: 'home', label: 'Home', glyph: '⌂' },
    { key: 'history', label: 'History', glyph: '≡' },
    { key: 'settings', label: 'Settings', glyph: '○' },
  ];

  return (
    <SafeAreaView style={styles.bottomNavSafe} edges={['bottom']}>
      <View style={styles.bottomNav}>
        {items.map((item) => {
          const active = screen === item.key;
          return (
            <Pressable
              key={item.key}
              style={styles.navItem}
              onPress={() => onNavigate(item.key)}
            >
              <Text style={[styles.navGlyph, active && styles.navActive]}>{item.glyph}</Text>
              <Text style={[styles.navLabel, active && styles.navActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function formatViolation(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatTime(value: string) {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  app: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  pageContent: { padding: 20, paddingBottom: 120, gap: 20 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  eyebrow: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.8,
    marginBottom: 8,
  },
  pageTitle: {
    color: COLORS.text,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '600',
    letterSpacing: -1.2,
  },
  pageSubtitle: { color: COLORS.muted, fontSize: 15, lineHeight: 22, marginTop: -10 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 11,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.white },
  liveBadgeText: { color: COLORS.white, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  heroCard: {
    backgroundColor: COLORS.white,
    borderRadius: 26,
    padding: 22,
  },
  heroLabel: { color: '#666666', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  speedRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 6 },
  heroSpeed: { color: COLORS.background, fontSize: 76, lineHeight: 82, fontWeight: '600', letterSpacing: -4 },
  heroUnit: { color: '#555555', fontSize: 16, fontWeight: '600', marginBottom: 13, marginLeft: 7 },
  heroCaption: { color: '#686868', fontSize: 13, marginTop: 2, marginBottom: 24 },
  primaryButton: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  primaryButtonText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  primaryButtonArrow: { color: COLORS.white, fontSize: 22 },
  secondaryButton: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D8D8D8',
    paddingHorizontal: 18,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  secondaryButtonText: { color: COLORS.background, fontSize: 15, fontWeight: '700' },
  secondaryButtonArrow: { color: COLORS.background, fontSize: 22 },
  pressed: { opacity: 0.7 },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionTitle: { color: COLORS.text, fontSize: 19, fontWeight: '600', letterSpacing: -0.3 },
  sectionMeta: { color: COLORS.muted, fontSize: 12 },
  textLink: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  metricGrid: { flexDirection: 'row', gap: 10 },
  metricCard: {
    flex: 1,
    minHeight: 104,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    padding: 14,
    justifyContent: 'space-between',
  },
  metricValue: { color: COLORS.white, fontSize: 27, fontWeight: '600', letterSpacing: -1 },
  metricLabel: { color: COLORS.muted, fontSize: 11 },
  listCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 15,
  },
  historyList: { marginTop: 6 },
  detectionRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 12 },
  detectionDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  detectionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detectionIconText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  detectionInfo: { flex: 1 },
  detectionPlate: { color: COLORS.text, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  detectionMeta: { color: COLORS.muted, fontSize: 11, marginTop: 5 },
  detectionRight: { alignItems: 'flex-end' },
  detectionSpeed: { color: COLORS.white, fontSize: 22, fontWeight: '600', letterSpacing: -0.7 },
  detectionUnit: { color: COLORS.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 2 },
  noticeCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    padding: 16,
    backgroundColor: COLORS.surface,
  },
  noticeTitle: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  noticeText: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginTop: 7 },
  cameraFallback: { flex: 1, backgroundColor: COLORS.background },
  permissionScreen: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: COLORS.background },
  permissionTitle: { color: COLORS.white, fontSize: 34, lineHeight: 40, fontWeight: '600', letterSpacing: -1.3 },
  permissionText: { color: COLORS.muted, fontSize: 15, lineHeight: 22, marginTop: 14, marginBottom: 28 },
  closeTextButton: { alignSelf: 'center', padding: 18 },
  closeText: { color: COLORS.muted, fontSize: 13, fontWeight: '600' },
  cameraContainer: { flex: 1, backgroundColor: COLORS.background },
  cameraShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.16)' },
  cameraTopBar: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  roundButtonText: { color: COLORS.white, fontSize: 25, lineHeight: 28 },
  roundButtonOutlined: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundButtonOutlinedText: { color: COLORS.white, fontSize: 22 },
  cameraStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    paddingHorizontal: 13,
    height: 38,
  },
  recordingDot: { borderRadius: 0 },
  cameraStatusText: { color: COLORS.white, fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  guideFrame: { position: 'absolute', top: '22%', bottom: '30%', left: 24, right: 24 },
  guideLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.9)' },
  guideLineA: { left: '22%' },
  guideLineB: { right: '22%' },
  lineLabel: {
    position: 'absolute',
    top: -13,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineLabelA: { left: '22%', marginLeft: -13 },
  lineLabelB: { right: '22%', marginRight: -13 },
  lineLabelText: { color: COLORS.background, fontSize: 11, fontWeight: '900' },
  cameraReadout: {
    position: 'absolute',
    left: 22,
    right: 22,
    top: '65%',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cameraReadoutRight: { alignItems: 'flex-end' },
  cameraReadoutLabel: { color: 'rgba(255,255,255,0.66)', fontSize: 8, fontWeight: '800', letterSpacing: 1.4 },
  cameraReadoutValue: { color: COLORS.white, fontSize: 17, fontWeight: '700', marginTop: 5 },
  cameraBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 18,
    alignItems: 'center',
  },
  cameraHint: { color: COLORS.white, fontSize: 11, fontWeight: '600', marginVertical: 12 },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 2,
    borderColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterOuterRecording: { borderColor: 'rgba(255,255,255,0.65)' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: COLORS.white },
  shutterInnerRecording: { width: 28, height: 28, borderRadius: 5 },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  processingTitle: { color: COLORS.white, fontSize: 22, fontWeight: '600', marginTop: 18 },
  processingText: { color: COLORS.muted, fontSize: 13, marginTop: 8 },
  emptyState: { flex: 1, justifyContent: 'center', padding: 24, gap: 24 },
  resultSpeedCard: { backgroundColor: COLORS.white, borderRadius: 26, padding: 22 },
  resultSpeedLabel: { color: '#5C5C5C', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  resultSpeedRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 4 },
  resultSpeed: { color: COLORS.background, fontSize: 88, lineHeight: 94, fontWeight: '600', letterSpacing: -5 },
  resultSpeedUnit: { color: '#555555', fontSize: 16, fontWeight: '600', marginBottom: 17, marginLeft: 7 },
  limitLine: { borderTopWidth: 1, borderTopColor: '#E2E2E2', paddingTop: 14, flexDirection: 'row', justifyContent: 'space-between' },
  limitText: { color: '#666666', fontSize: 12 },
  limitValue: { color: COLORS.background, fontSize: 12, fontWeight: '700' },
  plateCard: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 20, backgroundColor: COLORS.surface, padding: 18 },
  fieldLabel: { color: COLORS.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.25 },
  plateText: { color: COLORS.white, fontSize: 28, fontWeight: '600', letterSpacing: 2.4, marginTop: 14 },
  confidenceRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, paddingTop: 14, marginTop: 16 },
  confidenceLabel: { color: COLORS.muted, fontSize: 11 },
  confidenceValue: { color: COLORS.white, fontSize: 11, fontWeight: '700' },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  detailCell: { width: '48%', minHeight: 94, borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, backgroundColor: COLORS.surface, padding: 15, justifyContent: 'space-between' },
  detailValue: { color: COLORS.white, fontSize: 16, fontWeight: '600' },
  violationCard: { borderRadius: 20, backgroundColor: COLORS.white, padding: 18 },
  clearCard: { backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.border },
  clearText: { color: COLORS.white },
  clearMutedText: { color: COLORS.muted },
  violationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  violationEyebrow: { color: '#606060', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  reviewPill: { borderWidth: 1, borderColor: '#BDBDBD', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 9 },
  reviewPillText: { color: '#303030', fontSize: 8, fontWeight: '900', letterSpacing: 0.9 },
  violationTitle: { color: COLORS.background, fontSize: 24, fontWeight: '600', letterSpacing: -0.7, marginTop: 20 },
  violationText: { color: '#666666', fontSize: 12, lineHeight: 18, marginTop: 8 },
  footnote: { color: COLORS.muted, fontSize: 11, lineHeight: 16, textAlign: 'center', paddingHorizontal: 14 },
  settingsGroup: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 20, backgroundColor: COLORS.surface, padding: 16, gap: 18 },
  settingInputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  settingLabel: { color: COLORS.white, fontSize: 14, fontWeight: '600' },
  numberInputWrap: { minWidth: 130, height: 48, borderWidth: 1, borderColor: COLORS.borderStrong, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7 },
  numberInput: { color: COLORS.white, fontSize: 17, fontWeight: '700', minWidth: 48, textAlign: 'right', padding: 0 },
  inputSuffix: { color: COLORS.muted, fontSize: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  toggleCopy: { flex: 1 },
  settingDescription: { color: COLORS.muted, fontSize: 11, lineHeight: 17, marginTop: 5 },
  settingsDivider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },
  bottomNavSafe: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: COLORS.surface },
  bottomNav: { height: 70, flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, backgroundColor: COLORS.surface },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5 },
  navGlyph: { color: COLORS.muted, fontSize: 18 },
  navLabel: { color: COLORS.muted, fontSize: 9, fontWeight: '700' },
  navActive: { color: COLORS.white },
});
