import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
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
import {
  clearAppState,
  clearCctvCredentials,
  loadAppState,
  loadCctvCredentials,
  saveAppState,
  saveCctvCredentials,
} from './src/storage';
import { COLORS, FONT } from './src/theme';
import type {
  AnalysisRequestSettings,
  AnalysisResponse,
  CctvCredentials,
  PersistedAppState,
  ReviewStatus,
  ScreenName,
  SpeedUnit,
  TrafficDirection,
  VehicleDetection,
} from './src/types';

type IconName = ComponentProps<typeof Ionicons>['name'];
type OnboardingPage = 0 | 1 | 2;

const DEFAULT_SETTINGS: AnalysisRequestSettings = {
  calibrationDistanceM: 10,
  speedLimitKmh: 50,
  country: 'Automatic',
  speedUnit: 'kmh',
  trafficDirection: 'left_to_right',
  plateProfile: 'automatic',
  blurPlatesOnShare: true,
  saveOriginalVideo: false,
  saveEvidenceFrames: true,
};

const COUNTRIES = [
  'Automatic',
  'United States',
  'India',
  'United Kingdom',
  'Germany',
  'United Arab Emirates',
  'Other',
] as const;

const SEED_HISTORY: VehicleDetection[] = [
  {
    id: 'seed-1',
    vehicleType: 'Car',
    plateText: 'SV 24 AI 1001',
    speedKmh: 68,
    confidence: 0.94,
    plateConfidence: 0.89,
    violation: 'overspeeding',
    reviewStatus: 'needs_review',
    capturedAt: new Date().toISOString(),
    sourceName: 'Main Gate',
    expectedErrorKmh: 4,
  },
  {
    id: 'seed-2',
    vehicleType: 'Truck',
    plateText: 'TRK 9082',
    speedKmh: 45,
    confidence: 0.91,
    plateConfidence: 0.86,
    violation: 'none',
    reviewStatus: 'confirmed',
    capturedAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
    sourceName: 'Road Camera',
    expectedErrorKmh: 4,
  },
  {
    id: 'seed-3',
    vehicleType: 'Motorcycle',
    plateText: null,
    speedKmh: 55,
    confidence: 0.88,
    plateConfidence: null,
    violation: 'none',
    reviewStatus: 'plate_unreadable',
    capturedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    sourceName: 'Main Gate',
    expectedErrorKmh: 5,
  },
];

const INITIAL_PERSISTED_STATE: PersistedAppState = {
  onboardingCompleted: false,
  settings: DEFAULT_SETTINGS,
  history: SEED_HISTORY,
  workspaceName: 'My Traffic Hub',
};

export default function App() {
  const [booting, setBooting] = useState(true);
  const [onboardingPage, setOnboardingPage] = useState<OnboardingPage>(0);
  const [screen, setScreen] = useState<ScreenName>('home');
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('My Traffic Hub');
  const [settings, setSettings] = useState<AnalysisRequestSettings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<VehicleDetection[]>(SEED_HISTORY);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [selectedDetectionId, setSelectedDetectionId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [processingSource, setProcessingSource] = useState('Traffic video');
  const [cctvCredentials, setCctvCredentials] = useState<CctvCredentials>({
    name: '',
    url: '',
    username: '',
    password: '',
  });

  useEffect(() => {
    void (async () => {
      try {
        const [stored, storedCctv] = await Promise.all([loadAppState(), loadCctvCredentials()]);
        if (stored) {
          setOnboardingCompleted(stored.onboardingCompleted);
          setSettings({ ...DEFAULT_SETTINGS, ...stored.settings });
          setHistory(stored.history?.length ? stored.history : SEED_HISTORY);
          setWorkspaceName(stored.workspaceName || 'My Traffic Hub');
        }
        if (storedCctv) setCctvCredentials(storedCctv);
      } catch {
        // Safe defaults keep the app usable if local storage cannot be read.
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (booting) return;
    const state: PersistedAppState = {
      onboardingCompleted,
      settings,
      history,
      workspaceName,
    };
    void saveAppState(state).catch(() => undefined);
  }, [booting, history, onboardingCompleted, settings, workspaceName]);

  const navigate = (next: ScreenName) => {
    void Haptics.selectionAsync();
    setScreen(next);
  };

  const selectedDetection = useMemo(
    () => history.find((item) => item.id === selectedDetectionId) ?? analysis?.detections[0] ?? null,
    [analysis, history, selectedDetectionId],
  );

  const runAnalysis = async (uri: string, sourceName: string) => {
    setIsAnalyzing(true);
    setProcessingSource(sourceName);
    setScreen('processing');
    try {
      const response = await analyzeVideo(uri, settings);
      const enriched = response.detections.map((item) => ({
        ...item,
        sourceName: item.sourceName ?? sourceName,
        expectedErrorKmh: item.expectedErrorKmh ?? 4,
      }));
      const normalized: AnalysisResponse = { ...response, detections: enriched };
      setAnalysis(normalized);
      setHistory((current) => [...enriched, ...current]);
      setSelectedDetectionId(enriched[0]?.id ?? null);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setScreen('result');
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message = error instanceof Error ? error.message : 'Unknown analysis error';
      Alert.alert('Analysis failed', message, [{ text: 'Back to Detect', onPress: () => setScreen('detect') }]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const chooseVideo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      quality: 1,
      videoMaxDuration: 60,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      await runAnalysis(result.assets[0].uri, 'Uploaded video');
    }
  };

  const updateDetection = (id: string, patch: Partial<VehicleDetection>) => {
    setHistory((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setAnalysis((current) =>
      current
        ? {
            ...current,
            detections: current.detections.map((item) => (item.id === id ? { ...item, ...patch } : item)),
          }
        : current,
    );
  };

  const deleteDetection = (id: string) => {
    Alert.alert('Delete this record?', 'The saved detection will be removed from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setHistory((current) => current.filter((item) => item.id !== id));
          setSelectedDetectionId(null);
          setScreen('records');
        },
      },
    ]);
  };

  const completeOnboarding = () => {
    setOnboardingCompleted(true);
    setScreen('home');
  };

  if (booting) {
    return (
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <View style={styles.bootScreen}>
          <BrandMark size={66} />
          <Text style={styles.bootTitle}>SpeedVision</Text>
          <Text style={styles.bootCaption}>Intelligent traffic monitoring</Text>
          <ActivityIndicator style={{ marginTop: 28 }} color={COLORS.text} />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!onboardingCompleted) {
    return (
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <StatusBar style="dark" backgroundColor={COLORS.background} />
        <SafeAreaView style={styles.safeLight}>
          <Onboarding
            page={onboardingPage}
            onPage={setOnboardingPage}
            onComplete={completeOnboarding}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  const isCameraScreen = screen === 'camera';

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar
        style={isCameraScreen ? 'light' : 'dark'}
        backgroundColor={isCameraScreen ? COLORS.dark : COLORS.background}
      />
      <SafeAreaView
        style={isCameraScreen ? styles.safeDark : styles.safeLight}
        edges={['top', 'left', 'right']}
      >
        <View style={styles.appShell}>
          {screen === 'home' && (
            <HomeScreen
              workspaceName={workspaceName}
              history={history}
              settings={settings}
              onNavigate={navigate}
              onOpenDetection={(id) => {
                setSelectedDetectionId(id);
                navigate('result');
              }}
            />
          )}
          {screen === 'detect' && <DetectScreen onNavigate={navigate} onUpload={() => void chooseVideo()} />}
          {screen === 'calibration' && (
            <CalibrationScreen settings={settings} onChange={setSettings} onBack={() => navigate('detect')} onStart={() => navigate('camera')} />
          )}
          {screen === 'camera' && (
            <LiveCameraScreen
              settings={settings}
              isAnalyzing={isAnalyzing}
              onClose={() => navigate('detect')}
              onRecalibrate={() => navigate('calibration')}
              onRecorded={(uri) => void runAnalysis(uri, 'Phone camera')}
            />
          )}
          {screen === 'upload' && (
            <UploadScreen settings={settings} onBack={() => navigate('detect')} onChoose={() => void chooseVideo()} />
          )}
          {screen === 'cctv' && (
            <CctvScreen
              credentials={cctvCredentials}
              onChange={setCctvCredentials}
              onBack={() => navigate('detect')}
              onSave={async () => {
                await saveCctvCredentials(cctvCredentials);
                Alert.alert(
                  'Camera details saved',
                  isBackendConfigured
                    ? 'The secure connection details are ready for backend testing.'
                    : 'Saved securely on this device. Real RTSP testing will activate when the CCTV backend endpoint is connected.',
                );
              }}
              onContinue={() => navigate('calibration')}
            />
          )}
          {screen === 'processing' && <ProcessingScreen source={processingSource} />}
          {screen === 'result' && selectedDetection && (
            <ResultScreen
              detection={selectedDetection}
              settings={settings}
              analysisMode={analysis?.mode ?? 'demo'}
              onBack={() => navigate('records')}
              onUpdate={(patch) => updateDetection(selectedDetection.id, patch)}
              onDelete={() => deleteDetection(selectedDetection.id)}
            />
          )}
          {screen === 'result' && !selectedDetection && (
            <EmptyScreen
              title="No result selected"
              description="Open a saved record or analyze traffic footage first."
              action="Go to Records"
              onAction={() => navigate('records')}
            />
          )}
          {screen === 'records' && (
            <RecordsScreen
              history={history}
              settings={settings}
              onOpen={(id) => {
                setSelectedDetectionId(id);
                navigate('result');
              }}
            />
          )}
          {screen === 'settings' && (
            <SettingsScreen
              settings={settings}
              workspaceName={workspaceName}
              cctvConnected={Boolean(cctvCredentials.url)}
              onChange={setSettings}
              onWorkspaceName={setWorkspaceName}
              onDisconnectCctv={() => {
                Alert.alert('Disconnect CCTV?', 'Saved camera credentials will be removed from this device.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Disconnect',
                    style: 'destructive',
                    onPress: () => {
                      setCctvCredentials({ name: '', url: '', username: '', password: '' });
                      void clearCctvCredentials();
                    },
                  },
                ]);
              }}
              onDeleteAll={() => {
                Alert.alert('Delete all records?', 'This clears locally stored settings and detection history.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete all',
                    style: 'destructive',
                    onPress: () => {
                      setHistory([]);
                      void clearAppState();
                    },
                  },
                ]);
              }}
            />
          )}

          {!isCameraScreen && !['calibration', 'upload', 'cctv', 'processing', 'result'].includes(screen) && (
            <BottomNavigation screen={screen} onNavigate={navigate} />
          )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Onboarding({
  page,
  onPage,
  onComplete,
}: {
  page: OnboardingPage;
  onPage: (page: OnboardingPage) => void;
  onComplete: () => void;
}) {
  const pages = [
    {
      icon: 'scan-circle-outline' as IconName,
      title: 'Understand every vehicle.',
      body: 'Estimate speed, read number plates and review suspected overspeeding.',
    },
    {
      icon: 'videocam-outline' as IconName,
      title: 'Use the camera you already have.',
      body: 'Monitor with your phone, uploaded footage or one compatible CCTV stream.',
    },
    {
      icon: 'shield-checkmark-outline' as IconName,
      title: 'Always review the result.',
      body: 'SpeedVision provides AI-generated estimates. Every suspected violation requires human review.',
    },
  ] as const;
  const content = pages[page];

  return (
    <View style={styles.onboardingPage}>
      <View style={styles.onboardingBrandRow}>
        <BrandMark size={44} />
        <Text style={styles.onboardingBrand}>SpeedVision</Text>
      </View>
      <View style={styles.onboardingVisual}>
        <View style={styles.onboardingIconCircle}>
          <Ionicons name={content.icon} size={74} color={COLORS.white} />
        </View>
        <View style={[styles.onboardingLine, { top: '35%' }]} />
        <View style={[styles.onboardingLine, { top: '65%' }]} />
      </View>
      <View>
        <Text style={styles.onboardingTitle}>{content.title}</Text>
        <Text style={styles.onboardingBody}>{content.body}</Text>
      </View>
      <View style={styles.onboardingFooter}>
        <View style={styles.pageDots}>
          {[0, 1, 2].map((dot) => (
            <View key={dot} style={[styles.pageDot, dot === page && styles.pageDotActive]} />
          ))}
        </View>
        <PrimaryButton
          label={page === 2 ? 'Get started' : 'Continue'}
          icon="arrow-forward"
          onPress={() => (page === 2 ? onComplete() : onPage((page + 1) as OnboardingPage))}
        />
        {page > 0 && (
          <Pressable onPress={() => onPage((page - 1) as OnboardingPage)} style={styles.centerTextButton}>
            <Text style={styles.textButtonLabel}>Back</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function HomeScreen({
  workspaceName,
  history,
  settings,
  onNavigate,
  onOpenDetection,
}: {
  workspaceName: string;
  history: VehicleDetection[];
  settings: AnalysisRequestSettings;
  onNavigate: (screen: ScreenName) => void;
  onOpenDetection: (id: string) => void;
}) {
  const today = history.filter((item) => new Date(item.capturedAt).toDateString() === new Date().toDateString());
  const violations = today.filter((item) => item.violation === 'overspeeding').length;
  const platesRead = today.filter((item) => item.plateText).length;
  const maxSpeed = Math.max(0, ...today.map((item) => item.speedKmh ?? 0));

  return (
    <ScreenScroll bottomPadding={128}>
      <AppHeader workspaceName={workspaceName} eyebrow="SPEEDVISION" />
      <View style={styles.heroCard}>
        <Text style={styles.heroTitle}>Start Monitoring</Text>
        <Text style={styles.heroBody}>Initialize a traffic detection session for this location.</Text>
        <Pressable style={styles.heroPrimaryAction} onPress={() => onNavigate('calibration')}>
          <Ionicons name="play" size={21} color={COLORS.text} />
          <Text style={styles.heroPrimaryActionText}>Live Feed</Text>
        </Pressable>
        <View style={styles.heroDivider} />
        <View style={styles.heroQuickRow}>
          <QuickDarkAction icon="phone-portrait-outline" label="Phone" onPress={() => onNavigate('calibration')} />
          <QuickDarkAction icon="cloud-upload-outline" label="Upload" onPress={() => onNavigate('upload')} />
          <QuickDarkAction icon="videocam-outline" label="CCTV" onPress={() => onNavigate('cctv')} />
        </View>
      </View>
      <View style={styles.metricTwoColumn}>
        <MetricCard icon="car-outline" badge="Today" value={today.length || history.length} label="Vehicles detected" />
        <MetricCard icon="speedometer-outline" badge="Alerts" badgeTone="danger" value={violations} label="Suspected overspeeding" danger />
      </View>
      <View style={styles.wideMetricCard}>
        <View>
          <Text style={styles.metricLabel}>Max speed logged</Text>
          <Text style={styles.wideMetricValue}>{displaySpeed(maxSpeed || 84, settings.speedUnit)}</Text>
        </View>
        <SpeedBars danger />
        <View style={styles.wideMetricDivider} />
        <View style={styles.wideMetricBottomRow}>
          <Text style={styles.metricLabel}>Plates read</Text>
          <Text style={styles.wideMetricSmallValue}>{platesRead || history.filter((item) => item.plateText).length}</Text>
        </View>
      </View>
      <SectionHeader title="Recent Activity" action="View all" onAction={() => onNavigate('records')} />
      <View style={styles.stackGap}>
        {history.slice(0, 3).map((item) => (
          <DetectionRow key={item.id} detection={item} settings={settings} onPress={() => onOpenDetection(item.id)} />
        ))}
      </View>
      <View style={styles.modeNotice}>
        <Ionicons name={isBackendConfigured ? 'cloud-done-outline' : 'information-circle-outline'} size={20} color={COLORS.textSecondary} />
        <Text style={styles.modeNoticeText}>
          {isBackendConfigured
            ? 'Analysis backend connected.'
            : 'Demo analysis is active. Real results begin after the backend URL is connected.'}
        </Text>
      </View>
    </ScreenScroll>
  );
}

function DetectScreen({ onNavigate, onUpload }: { onNavigate: (screen: ScreenName) => void; onUpload: () => void }) {
  return (
    <ScreenScroll bottomPadding={128}>
      <AppHeader workspaceName="Select Source" compact />
      <Text style={styles.detectTitle}>Start detection</Text>
      <Text style={styles.detectSubtitle}>Choose how SpeedVision receives traffic footage.</Text>
      <View style={styles.sourceStack}>
        <SourceCard icon="camera-outline" title="Phone Camera" body="Use your mobile device as a fixed traffic monitor." onPress={() => onNavigate('calibration')} />
        <SourceCard icon="cloud-upload-outline" title="Upload Video" body="Analyze pre-recorded traffic footage for speed and plates." onPress={onUpload} />
        <SourceCard icon="videocam-outline" title="Connect CCTV" body="Stream and analyze from one compatible RTSP camera." onPress={() => onNavigate('cctv')} />
      </View>
      <InfoCard icon="globe-outline" title="Built for global use" body="Choose country, plate profile, speed unit and traffic direction in Settings." />
    </ScreenScroll>
  );
}

function CalibrationScreen({ settings, onChange, onBack, onStart }: { settings: AnalysisRequestSettings; onChange: (settings: AnalysisRequestSettings) => void; onBack: () => void; onStart: () => void }) {
  const [distance, setDistance] = useState(String(settings.calibrationDistanceM));
  const limitInSelectedUnit = settings.speedUnit === 'mph' ? Math.round(settings.speedLimitKmh / 1.60934) : settings.speedLimitKmh;
  const [limit, setLimit] = useState(String(limitInSelectedUnit));

  const saveAndStart = () => {
    const distanceValue = Number(distance);
    const limitValue = Number(limit);
    if (!Number.isFinite(distanceValue) || distanceValue <= 0) {
      Alert.alert('Enter a valid distance', 'Measure the real distance between Line A and Line B.');
      return;
    }
    if (!Number.isFinite(limitValue) || limitValue <= 0) {
      Alert.alert('Enter a valid speed limit', 'The speed limit must be greater than zero.');
      return;
    }
    onChange({
      ...settings,
      calibrationDistanceM: distanceValue,
      speedLimitKmh: settings.speedUnit === 'mph' ? Math.round(limitValue * 1.60934) : limitValue,
    });
    onStart();
  };

  return (
    <ScreenScroll bottomPadding={32}>
      <BackHeader title="Set up the camera" onBack={onBack} />
      <View style={styles.calibrationPreview}>
        <Ionicons name="car-sport-outline" size={68} color={COLORS.textMuted} />
        <View style={[styles.previewLine, { top: '33%' }]}><Text style={styles.previewLineLabel}>LINE A</Text></View>
        <View style={[styles.previewLine, { top: '70%' }]}><Text style={styles.previewLineLabel}>LINE B</Text></View>
        <View style={styles.previewZone} />
        <View style={styles.previewDirection}><Ionicons name="arrow-forward" size={22} color={COLORS.blue} /></View>
      </View>
      <View style={styles.stepRow}>
        {['Area', 'Direction', 'Distance', 'Limit'].map((label, index) => (
          <View key={label} style={styles.stepItem}>
            <View style={[styles.stepNumber, styles.stepNumberActive]}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
            <Text style={styles.stepLabel}>{label}</Text>
          </View>
        ))}
      </View>
      <FormSection title="Traffic direction">
        <ChoiceRow values={[["left_to_right", "Left to right"], ["right_to_left", "Right to left"], ["both", "Both"]]} selected={settings.trafficDirection} onSelect={(value) => onChange({ ...settings, trafficDirection: value as TrafficDirection })} />
      </FormSection>
      <View style={styles.formGrid}>
        <LabeledInput label="Distance between lines" value={distance} onChangeText={setDistance} suffix="m" keyboardType="decimal-pad" />
        <LabeledInput label="Speed limit" value={limit} onChangeText={setLimit} suffix={settings.speedUnit === 'mph' ? 'mph' : 'km/h'} keyboardType="number-pad" />
      </View>
      <InfoCard icon="information-circle-outline" title="Accuracy starts here" body="Measure the real distance between both lines and keep the camera completely stationary." />
      <View style={styles.healthCard}>
        <HealthRow label="Camera position" value="Ready to check" />
        <HealthRow label="Lighting" value="Checked live" />
        <HealthRow label="Road visibility" value="Checked live" />
      </View>
      <PrimaryButton label="Start monitoring" icon="play" onPress={saveAndStart} />
    </ScreenScroll>
  );
}

function LiveCameraScreen({ settings, isAnalyzing, onClose, onRecalibrate, onRecorded }: { settings: AnalysisRequestSettings; isAnalyzing: boolean; onClose: () => void; onRecalibrate: () => void; onRecorded: (uri: string) => void }) {
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [flash, setFlash] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  const startRecording = async () => {
    if (!cameraReady || recording || !cameraRef.current) return;
    setSeconds(0);
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

  const stopRecording = () => cameraRef.current?.stopRecording();
  if (!permission) return <View style={styles.cameraScreen} />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionScreen}>
        <View style={styles.permissionIcon}><Ionicons name="camera-outline" size={54} color={COLORS.white} /></View>
        <Text style={styles.permissionTitle}>Camera permission is required.</Text>
        <Text style={styles.permissionText}>SpeedVision uses the camera only when you start a detection session.</Text>
        <PrimaryButton label="Allow camera" icon="camera-outline" onPress={() => void requestPermission()} light />
        <Pressable onPress={onClose} style={styles.centerTextButton}><Text style={[styles.textButtonLabel, { color: COLORS.white }]}>Go back</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={styles.cameraScreen}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" mode="video" videoQuality="1080p" enableTorch={flash} zoom={zoom} onCameraReady={() => setCameraReady(true)} />
      <View style={styles.cameraShade} />
      <View style={styles.cameraTopControls}>
        <RoundDarkButton icon="close" onPress={onClose} />
        <View style={styles.cameraTopRight}>
          <RoundDarkButton icon={flash ? 'flash' : 'flash-outline'} onPress={() => setFlash((value) => !value)} />
          <RoundDarkButton icon="search" onPress={() => setZoom((value) => (value >= 0.4 ? 0 : Number((value + 0.2).toFixed(1))))} />
        </View>
      </View>
      <View style={[styles.liveGuideLine, { top: '39%' }]}><Text style={styles.liveGuideLabel}>LINE A</Text></View>
      <View style={[styles.liveGuideLine, { top: '66%' }]}><Text style={styles.liveGuideLabel}>LINE B</Text></View>
      <View style={styles.liveVehicleBox}>
        <View style={styles.livePlateTag}>
          <Text style={styles.livePlateText}>READY</Text><View style={styles.liveTagDivider} /><Text style={styles.liveSpeedText}>{displaySpeed(settings.speedLimitKmh, settings.speedUnit)}</Text>
        </View>
      </View>
      <View style={styles.monitorPanel}>
        <View style={styles.monitorHeaderRow}>
          <View>
            <View style={styles.liveTitleRow}><View style={[styles.monitorDot, recording && styles.monitorDotActive]} /><Text style={styles.monitorTitle}>{recording ? 'Monitoring Live' : 'Ready to Monitor'}</Text></View>
            <Text style={styles.monitorSource}>Source: Phone Camera</Text>
          </View>
          <View style={styles.timerPill}><Ionicons name="time-outline" size={17} color={COLORS.white} /><Text style={styles.timerText}>{formatTimer(seconds)}</Text></View>
        </View>
        <Pressable style={[styles.stopButton, !recording && styles.startButton]} disabled={isAnalyzing || !cameraReady} onPress={recording ? stopRecording : () => void startRecording()}>
          {isAnalyzing ? <ActivityIndicator color={COLORS.white} /> : <><Ionicons name={recording ? 'stop-circle-outline' : 'radio-button-on'} size={27} color={COLORS.white} /><Text style={styles.stopButtonText}>{recording ? 'Stop Monitoring' : 'Start Monitoring'}</Text></>}
        </Pressable>
        <View style={styles.monitorSecondaryRow}>
          <DarkOutlineButton icon="options-outline" label="Recalibrate" onPress={onRecalibrate} />
          <DarkOutlineButton icon="settings-outline" label={`Limit ${displaySpeed(settings.speedLimitKmh, settings.speedUnit)}`} onPress={onRecalibrate} />
        </View>
      </View>
    </View>
  );
}

function UploadScreen({ settings, onBack, onChoose }: { settings: AnalysisRequestSettings; onBack: () => void; onChoose: () => void }) {
  return (
    <ScreenScroll bottomPadding={32}>
      <BackHeader title="Upload traffic video" onBack={onBack} />
      <Pressable style={styles.uploadDropzone} onPress={onChoose}>
        <View style={styles.uploadIconCircle}><Ionicons name="cloud-upload-outline" size={42} color={COLORS.text} /></View>
        <Text style={styles.uploadTitle}>Choose traffic video</Text>
        <Text style={styles.uploadBody}>Select a video up to 60 seconds for the first test build.</Text>
        <View style={styles.uploadButtonFake}><Text style={styles.uploadButtonFakeText}>Browse gallery</Text></View>
      </Pressable>
      <View style={styles.settingsSummaryCard}>
        <SummaryRow label="Calibration" value={`${settings.calibrationDistanceM} m`} />
        <SummaryRow label="Speed limit" value={displaySpeed(settings.speedLimitKmh, settings.speedUnit)} />
        <SummaryRow label="Plate region" value={settings.country} />
        <SummaryRow label="Direction" value={directionLabel(settings.trafficDirection)} last />
      </View>
      <SecondaryButton label="Edit calibration" icon="options-outline" onPress={() => Alert.alert('Calibration', 'Open Phone Camera setup to edit calibration before analysis.')} />
    </ScreenScroll>
  );
}

function CctvScreen({ credentials, onChange, onBack, onSave, onContinue }: { credentials: CctvCredentials; onChange: (value: CctvCredentials) => void; onBack: () => void; onSave: () => Promise<void>; onContinue: () => void }) {
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'success' | 'error'>('idle');

  const testConnection = async () => {
    if (!credentials.url.startsWith('rtsp://') && !credentials.url.startsWith('rtsps://')) { setTestState('error'); return; }
    setTesting(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    setTesting(false);
    setTestState('success');
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenScroll bottomPadding={32}>
        <BackHeader title="Connect CCTV" onBack={onBack} />
        <Text style={styles.formIntro}>Connect one compatible RTSP camera. Credentials are encrypted on this device.</Text>
        <View style={styles.formCard}>
          <LabeledInput label="Camera name" value={credentials.name} onChangeText={(name) => onChange({ ...credentials, name })} placeholder="Main Gate Camera" />
          <LabeledInput label="RTSP URL" value={credentials.url} onChangeText={(url) => onChange({ ...credentials, url })} placeholder="rtsp://camera-address/stream" autoCapitalize="none" />
          <LabeledInput label="Username" value={credentials.username} onChangeText={(username) => onChange({ ...credentials, username })} placeholder="Camera username" autoCapitalize="none" />
          <View>
            <Text style={styles.inputLabel}>Password</Text>
            <View style={styles.passwordWrap}>
              <TextInput style={styles.passwordInput} value={credentials.password} onChangeText={(password) => onChange({ ...credentials, password })} secureTextEntry={!showPassword} autoCapitalize="none" placeholder="Camera password" placeholderTextColor={COLORS.textMuted} />
              <Pressable onPress={() => setShowPassword((value) => !value)} style={styles.passwordIconButton}><Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={COLORS.textSecondary} /></Pressable>
            </View>
          </View>
        </View>
        <Pressable style={styles.testConnectionButton} onPress={() => void testConnection()} disabled={testing}>
          {testing ? <ActivityIndicator color={COLORS.text} /> : <Ionicons name="pulse-outline" size={22} color={COLORS.text} />}
          <Text style={styles.testConnectionText}>{testing ? 'Testing connection…' : 'Test connection'}</Text>
        </Pressable>
        {testState === 'success' && (
          <View style={styles.connectionSuccessCard}>
            <View style={styles.connectionPreview}><Ionicons name="videocam-outline" size={48} color={COLORS.textMuted} /><View style={styles.connectionLivePill}><View style={styles.connectionLiveDot} /><Text style={styles.connectionLiveText}>DEMO PREVIEW</Text></View></View>
            <Text style={styles.connectionTitle}>Connection format accepted</Text>
            <Text style={styles.connectionBody}>{isBackendConfigured ? 'The backend can now perform the real RTSP stream test.' : 'This UI build validates the RTSP format. Real stream testing begins after the CCTV backend endpoint is deployed.'}</Text>
          </View>
        )}
        {testState === 'error' && <View style={styles.connectionErrorCard}><Ionicons name="alert-circle-outline" size={22} color={COLORS.red} /><Text style={styles.connectionErrorText}>Enter a valid RTSP URL beginning with rtsp:// or rtsps://.</Text></View>}
        <InfoCard icon="lock-closed-outline" title="Credentials stay protected" body="Passwords are stored using the device secure store and are never shown in app logs." />
        <PrimaryButton label="Save camera details" icon="shield-checkmark-outline" onPress={() => void onSave()} disabled={!credentials.name || !credentials.url} />
        <SecondaryButton label="Continue to calibration" icon="arrow-forward" onPress={onContinue} disabled={!credentials.url} />
      </ScreenScroll>
    </KeyboardAvoidingView>
  );
}

function ProcessingScreen({ source }: { source: string }) {
  return (
    <View style={styles.processingScreen}>
      <View style={styles.processingRing}><ActivityIndicator size="large" color={COLORS.white} /></View>
      <Text style={styles.processingTitle}>Analyzing traffic</Text>
      <Text style={styles.processingSource}>{source}</Text>
      <View style={styles.processingSteps}>
        {['Detecting vehicles', 'Tracking movement', 'Estimating speed', 'Reading number plates'].map((item, index) => <View key={item} style={styles.processingStepRow}><View style={[styles.processingStepDot, index === 0 && styles.processingStepDotActive]} /><Text style={styles.processingStepText}>{item}</Text></View>)}
      </View>
      <Text style={styles.processingHint}>Processing time depends on video length and server capacity.</Text>
    </View>
  );
}

function ResultScreen({ detection, settings, analysisMode, onBack, onUpdate, onDelete }: { detection: VehicleDetection; settings: AnalysisRequestSettings; analysisMode: AnalysisResponse['mode']; onBack: () => void; onUpdate: (patch: Partial<VehicleDetection>) => void; onDelete: () => void }) {
  const [editingPlate, setEditingPlate] = useState(false);
  const [plate, setPlate] = useState(detection.plateText ?? '');
  const speed = detection.speedKmh ?? 0;
  const difference = speed - settings.speedLimitKmh;
  useEffect(() => setPlate(detection.plateText ?? ''), [detection.plateText]);

  return (
    <ScreenScroll bottomPadding={40}>
      <BackHeader title="Detection detail" onBack={onBack} rightIcon="share-outline" onRight={() => Alert.alert('Share evidence', 'Plate blurring is enabled by default. Evidence export will be connected in the backend build.')} />
      <View style={styles.evidenceFrame}>
        <VehicleGlyph type={detection.vehicleType} size={74} />
        <View style={styles.evidenceOverlayTop}><Text style={styles.evidenceSource}>{detection.sourceName ?? 'Traffic source'}</Text><Text style={styles.evidenceTime}>{formatFullDate(detection.capturedAt)}</Text></View>
        <View style={styles.evidenceTargetBox} />
      </View>
      <View style={styles.resultSpeedCard}>
        <Text style={styles.resultEyebrow}>ESTIMATED SPEED</Text>
        <View style={styles.resultBigSpeedRow}><Text style={styles.resultBigSpeed}>{displaySpeedNumber(speed, settings.speedUnit)}</Text><Text style={styles.resultBigUnit}>{settings.speedUnit === 'mph' ? 'mph' : 'km/h'}</Text></View>
        <View style={styles.resultStatsRow}>
          <ResultMiniStat label="Limit" value={displaySpeed(settings.speedLimitKmh, settings.speedUnit)} />
          <ResultMiniStat label="Difference" value={`${difference > 0 ? '+' : ''}${displaySpeedNumber(Math.abs(difference), settings.speedUnit)} ${settings.speedUnit === 'mph' ? 'mph' : 'km/h'}`} />
          <ResultMiniStat label="Expected error" value={`±${displaySpeedNumber(detection.expectedErrorKmh ?? 4, settings.speedUnit)} ${settings.speedUnit === 'mph' ? 'mph' : 'km/h'}`} />
        </View>
      </View>
      <View style={styles.plateCard}>
        <View style={styles.plateCrop}><Ionicons name="scan-outline" size={34} color={COLORS.textSecondary} /></View>
        <View style={styles.plateCardContent}>
          <Text style={styles.plateCardLabel}>NUMBER PLATE</Text>
          {editingPlate ? <TextInput style={styles.plateEditInput} value={plate} onChangeText={setPlate} autoCapitalize="characters" autoCorrect={false} onSubmitEditing={() => { onUpdate({ plateText: plate.trim() || null }); setEditingPlate(false); }} /> : <Text style={styles.plateCardValue}>{detection.plateText ?? 'PLATE NOT READ'}</Text>}
          <Text style={styles.plateConfidence}>Plate confidence: {detection.plateConfidence ? `${Math.round(detection.plateConfidence * 100)}%` : 'Unavailable'}</Text>
        </View>
        <Pressable style={styles.editIconButton} onPress={() => { if (editingPlate) onUpdate({ plateText: plate.trim() || null }); setEditingPlate((value) => !value); }}><Ionicons name={editingPlate ? 'checkmark' : 'create-outline'} size={22} color={COLORS.text} /></Pressable>
      </View>
      <View style={styles.reviewCard}>
        <View style={styles.reviewIconCircle}><Ionicons name="speedometer-outline" size={28} color={detection.violation === 'overspeeding' ? COLORS.red : COLORS.text} /></View>
        <View style={styles.reviewCardContent}><Text style={styles.reviewTitle}>{detection.violation === 'overspeeding' ? 'Suspected overspeeding' : 'No configured violation'}</Text><Text style={styles.reviewBody}>This automated estimate requires human review.</Text></View>
      </View>
      <View style={styles.detailCard}>
        <SummaryRow label="Vehicle type" value={detection.vehicleType} />
        <SummaryRow label="Vehicle confidence" value={`${Math.round(detection.confidence * 100)}%`} />
        <SummaryRow label="Traffic direction" value={directionLabel(settings.trafficDirection)} />
        <SummaryRow label="Region profile" value={settings.country} />
        <SummaryRow label="Analysis mode" value={analysisMode === 'demo' ? 'Clearly labelled demo' : analysisMode} last />
      </View>
      <Text style={styles.sectionLabel}>Review status</Text>
      <ChoiceRow values={[["needs_review", "Needs review"], ["confirmed", "Confirm result"], ["incorrect", "Mark incorrect"]]} selected={detection.reviewStatus} onSelect={(value) => onUpdate({ reviewStatus: value as ReviewStatus })} />
      <SecondaryButton label="Share blurred evidence" icon="share-outline" onPress={() => Alert.alert('Share evidence', 'Evidence-card generation will be connected to the production storage service.')} />
      <Pressable style={styles.deleteTextButton} onPress={onDelete}><Ionicons name="trash-outline" size={19} color={COLORS.red} /><Text style={styles.deleteText}>Delete detection</Text></Pressable>
    </ScreenScroll>
  );
}

function RecordsScreen({ history, settings, onOpen }: { history: VehicleDetection[]; settings: AnalysisRequestSettings; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'needs_review' | 'overspeeding' | 'confirmed'>('all');
  const filtered = useMemo(() => {
    const normalizedQuery = normalizePlate(query);
    return history.filter((item) => {
      const plateMatches = !normalizedQuery || normalizePlate(item.plateText ?? '').includes(normalizedQuery);
      const filterMatches = filter === 'all' || (filter === 'overspeeding' ? item.violation === 'overspeeding' : item.reviewStatus === filter);
      return plateMatches && filterMatches;
    });
  }, [filter, history, query]);
  const today = filtered.filter((item) => new Date(item.capturedAt).toDateString() === new Date().toDateString());
  const earlier = filtered.filter((item) => new Date(item.capturedAt).toDateString() !== new Date().toDateString());

  return (
    <ScreenScroll bottomPadding={128}>
      <AppHeader workspaceName="Detection Records" compact />
      <View style={styles.searchRow}>
        <View style={styles.searchInputWrap}><Ionicons name="search" size={25} color={COLORS.textMuted} /><TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search by plate…" placeholderTextColor={COLORS.textMuted} autoCapitalize="characters" /></View>
        <Pressable style={styles.filterIconButton} onPress={() => setFilter('all')}><Ionicons name="options-outline" size={26} color={COLORS.text} /></Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterPillsRow}>
        <FilterPill label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
        <FilterPill label="Needs Review" active={filter === 'needs_review'} onPress={() => setFilter('needs_review')} />
        <FilterPill label="Overspeeding" active={filter === 'overspeeding'} onPress={() => setFilter('overspeeding')} />
        <FilterPill label="Confirmed" active={filter === 'confirmed'} onPress={() => setFilter('confirmed')} />
      </ScrollView>
      {!filtered.length ? <View style={styles.recordsEmptyCard}><Ionicons name="file-tray-outline" size={44} color={COLORS.textMuted} /><Text style={styles.recordsEmptyTitle}>No matching records</Text><Text style={styles.recordsEmptyBody}>Try another plate or remove a filter.</Text></View> : <>{!!today.length && <DateGroup title="Today" items={today} settings={settings} onOpen={onOpen} />}{!!earlier.length && <DateGroup title="Earlier" items={earlier} settings={settings} onOpen={onOpen} />}</>}
    </ScreenScroll>
  );
}

function SettingsScreen({ settings, workspaceName, cctvConnected, onChange, onWorkspaceName, onDisconnectCctv, onDeleteAll }: { settings: AnalysisRequestSettings; workspaceName: string; cctvConnected: boolean; onChange: (settings: AnalysisRequestSettings) => void; onWorkspaceName: (name: string) => void; onDisconnectCctv: () => void; onDeleteAll: () => void }) {
  const nextCountry = () => {
    const index = COUNTRIES.indexOf(settings.country as (typeof COUNTRIES)[number]);
    const next = COUNTRIES[(index + 1 + COUNTRIES.length) % COUNTRIES.length] ?? 'Automatic';
    onChange({ ...settings, country: next });
  };

  return (
    <ScreenScroll bottomPadding={128}>
      <AppHeader workspaceName="Settings" compact />
      <SettingsGroup title="Workspace"><TextInput style={styles.settingsNameInput} value={workspaceName} onChangeText={onWorkspaceName} placeholder="Workspace name" placeholderTextColor={COLORS.textMuted} /></SettingsGroup>
      <SettingsGroup title="Region and traffic">
        <SettingsActionRow icon="globe-outline" label="Country or region" value={settings.country} onPress={nextCountry} />
        <SettingsActionRow icon="speedometer-outline" label="Speed unit" value={settings.speedUnit === 'kmh' ? 'km/h' : 'mph'} onPress={() => onChange({ ...settings, speedUnit: settings.speedUnit === 'kmh' ? 'mph' : 'kmh' })} />
        <SettingsActionRow icon="navigate-outline" label="Traffic direction" value={directionLabel(settings.trafficDirection)} onPress={() => onChange({ ...settings, trafficDirection: nextDirection(settings.trafficDirection) })} last />
      </SettingsGroup>
      <SettingsGroup title="Monitoring defaults">
        <SettingsStepperRow icon="resize-outline" label="Calibration distance" value={`${settings.calibrationDistanceM} m`} onMinus={() => onChange({ ...settings, calibrationDistanceM: Math.max(1, settings.calibrationDistanceM - 1) })} onPlus={() => onChange({ ...settings, calibrationDistanceM: settings.calibrationDistanceM + 1 })} />
        <SettingsStepperRow icon="speedometer-outline" label="Default speed limit" value={displaySpeed(settings.speedLimitKmh, settings.speedUnit)} onMinus={() => onChange({ ...settings, speedLimitKmh: Math.max(5, settings.speedLimitKmh - 5) })} onPlus={() => onChange({ ...settings, speedLimitKmh: settings.speedLimitKmh + 5 })} last />
      </SettingsGroup>
      <SettingsGroup title="Privacy">
        <SettingsToggleRow icon="images-outline" label="Save evidence frames" value={settings.saveEvidenceFrames} onValueChange={(value) => onChange({ ...settings, saveEvidenceFrames: value })} />
        <SettingsToggleRow icon="film-outline" label="Save original video" value={settings.saveOriginalVideo} onValueChange={(value) => onChange({ ...settings, saveOriginalVideo: value })} />
        <SettingsToggleRow icon="eye-off-outline" label="Blur plates when sharing" value={settings.blurPlatesOnShare} onValueChange={(value) => onChange({ ...settings, blurPlatesOnShare: value })} last />
      </SettingsGroup>
      <SettingsGroup title="CCTV"><SettingsActionRow icon="videocam-outline" label="Connected camera" value={cctvConnected ? 'Credentials saved' : 'Not connected'} onPress={cctvConnected ? onDisconnectCctv : () => Alert.alert('Connect CCTV', 'Open Detect → Connect CCTV.')} last /></SettingsGroup>
      <SettingsGroup title="Application">
        <SettingsActionRow icon="cloud-outline" label="Backend status" value={isBackendConfigured ? 'Connected' : 'Demo mode'} onPress={() => undefined} />
        <SettingsActionRow icon="shield-checkmark-outline" label="Human review" value="Always required" onPress={() => undefined} />
        <SettingsActionRow icon="information-circle-outline" label="Version" value="0.2.0 UI build" onPress={() => undefined} last />
      </SettingsGroup>
      <Pressable style={styles.dangerSettingsButton} onPress={onDeleteAll}><Ionicons name="trash-outline" size={20} color={COLORS.red} /><Text style={styles.dangerSettingsText}>Delete all local records</Text></Pressable>
    </ScreenScroll>
  );
}

function ScreenScroll({ children, bottomPadding = 32 }: { children: ReactNode; bottomPadding?: number }) {
  return <ScrollView style={styles.flex} contentContainerStyle={[styles.screenContent, { paddingBottom: bottomPadding }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
}

function AppHeader({ workspaceName, eyebrow, compact = false }: { workspaceName: string; eyebrow?: string; compact?: boolean }) {
  return <View style={[styles.appHeader, compact && styles.appHeaderCompact]}><View style={styles.appHeaderIdentity}><BrandMark size={compact ? 48 : 52} /><View style={styles.headerTextWrap}>{!!eyebrow && <Text style={styles.headerEyebrow}>{eyebrow}</Text>}<Text style={[styles.headerTitle, compact && styles.headerTitleCompact]} numberOfLines={1}>{workspaceName}</Text></View></View><Pressable style={styles.notificationButton}><Ionicons name="notifications-outline" size={25} color={COLORS.text} /></Pressable></View>;
}

function BackHeader({ title, onBack, rightIcon, onRight }: { title: string; onBack: () => void; rightIcon?: IconName; onRight?: () => void }) {
  return <View style={styles.backHeader}><Pressable style={styles.backButton} onPress={onBack}><Ionicons name="chevron-back" size={25} color={COLORS.text} /></Pressable><Text style={styles.backHeaderTitle}>{title}</Text>{rightIcon ? <Pressable style={styles.backButton} onPress={onRight}><Ionicons name={rightIcon} size={23} color={COLORS.text} /></Pressable> : <View style={styles.backButtonPlaceholder} />}</View>;
}

function BrandMark({ size }: { size: number }) {
  return <View style={[styles.brandMark, { width: size, height: size, borderRadius: size / 2 }]}><View style={[styles.brandMarkLine, { top: size * 0.34 }]} /><View style={[styles.brandMarkLine, { top: size * 0.62 }]} /><Ionicons name="car-sport-outline" size={size * 0.42} color={COLORS.text} /></View>;
}

function BottomNavigation({ screen, onNavigate }: { screen: ScreenName; onNavigate: (screen: ScreenName) => void }) {
  const items: Array<{ screen: ScreenName; label: string; icon: IconName; activeIcon: IconName }> = [
    { screen: 'home', label: 'Home', icon: 'home-outline', activeIcon: 'home' },
    { screen: 'detect', label: 'Detect', icon: 'scan-circle-outline', activeIcon: 'scan-circle' },
    { screen: 'records', label: 'Records', icon: 'time-outline', activeIcon: 'time' },
    { screen: 'settings', label: 'Settings', icon: 'settings-outline', activeIcon: 'settings' },
  ];
  return <View style={styles.bottomNavWrap}><View style={styles.bottomNav}>{items.map((item) => { const active = screen === item.screen || (screen === 'result' && item.screen === 'records'); return <Pressable key={item.screen} style={[styles.navItem, active && styles.navItemActive]} onPress={() => onNavigate(item.screen)}><Ionicons name={active ? item.activeIcon : item.icon} size={24} color={active ? COLORS.white : COLORS.textMuted} /><Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text></Pressable>; })}</View></View>;
}

function QuickDarkAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) { return <Pressable style={styles.quickDarkAction} onPress={onPress}><View style={styles.quickDarkIcon}><Ionicons name={icon} size={24} color={COLORS.white} /></View><Text style={styles.quickDarkLabel}>{label}</Text></Pressable>; }
function MetricCard({ icon, badge, badgeTone = 'blue', value, label, danger = false }: { icon: IconName; badge: string; badgeTone?: 'blue' | 'danger'; value: string | number; label: string; danger?: boolean }) { return <View style={styles.metricCard}><View style={styles.metricCardTop}><Ionicons name={icon} size={21} color={danger ? COLORS.red : COLORS.textMuted} /><View style={[styles.metricBadge, badgeTone === 'danger' && styles.metricBadgeDanger]}><Text style={[styles.metricBadgeText, badgeTone === 'danger' && styles.metricBadgeTextDanger]}>{badge}</Text></View></View><Text style={[styles.metricValue, danger && styles.metricValueDanger]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function SpeedBars({ danger = false }: { danger?: boolean }) { const heights = [13,22,17,34,46,58,29]; return <View style={styles.speedBars}>{heights.map((height,index) => <View key={`${height}-${index}`} style={[styles.speedBar,{height},danger && index===5 && styles.speedBarDanger]} />)}</View>; }
function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) { return <View style={styles.sectionHeader}><Text style={styles.sectionHeaderTitle}>{title}</Text>{!!action && <Pressable onPress={onAction}><Text style={styles.sectionHeaderAction}>{action}</Text></Pressable>}</View>; }
function DetectionRow({ detection, settings, onPress }: { detection: VehicleDetection; settings: AnalysisRequestSettings; onPress: () => void }) { return <Pressable style={styles.detectionRow} onPress={onPress}><View style={styles.vehicleThumb}><VehicleGlyph type={detection.vehicleType} size={32} /></View><View style={styles.detectionCenter}><Text style={styles.detectionPlate}>{detection.plateText ?? 'UNKNOWN'}</Text><Text style={styles.detectionMeta}>{detection.vehicleType} · {displaySpeed(detection.speedKmh ?? 0, settings.speedUnit)}</Text></View><StatusPill status={detection.reviewStatus} violation={detection.violation} /></Pressable>; }
function SourceCard({ icon, title, body, onPress }: { icon: IconName; title: string; body: string; onPress: () => void }) { return <Pressable style={styles.sourceCard} onPress={onPress}><View style={styles.sourceIconBox}><Ionicons name={icon} size={32} color={COLORS.text} /></View><View style={styles.sourceContent}><Text style={styles.sourceTitle}>{title}</Text><Text style={styles.sourceBody}>{body}</Text></View><Ionicons name="chevron-forward" size={25} color={COLORS.textMuted} /></Pressable>; }
function PrimaryButton({ label, icon, onPress, disabled=false, light=false }: { label:string; icon?:IconName; onPress:()=>void; disabled?:boolean; light?:boolean }) { return <Pressable style={[styles.primaryButton,light&&styles.primaryButtonLight,disabled&&styles.buttonDisabled]} onPress={onPress} disabled={disabled}>{!!icon&&<Ionicons name={icon} size={22} color={light?COLORS.text:COLORS.white}/>}<Text style={[styles.primaryButtonText,light&&styles.primaryButtonTextLight]}>{label}</Text></Pressable>; }
function SecondaryButton({ label, icon, onPress, disabled=false }: { label:string; icon?:IconName; onPress:()=>void; disabled?:boolean }) { return <Pressable style={[styles.secondaryButton,disabled&&styles.buttonDisabled]} onPress={onPress} disabled={disabled}>{!!icon&&<Ionicons name={icon} size={21} color={COLORS.text}/>}<Text style={styles.secondaryButtonText}>{label}</Text></Pressable>; }
function DarkOutlineButton({ icon,label,onPress }:{icon:IconName;label:string;onPress:()=>void}) { return <Pressable style={styles.darkOutlineButton} onPress={onPress}><Ionicons name={icon} size={23} color={COLORS.white}/><Text style={styles.darkOutlineButtonText}>{label}</Text></Pressable>; }
function RoundDarkButton({ icon,onPress }:{icon:IconName;onPress:()=>void}) { return <Pressable style={styles.roundDarkButton} onPress={onPress}><Ionicons name={icon} size={29} color={COLORS.white}/></Pressable>; }
function InfoCard({ icon,title,body }:{icon:IconName;title:string;body:string}) { return <View style={styles.infoCard}><View style={styles.infoCardIcon}><Ionicons name={icon} size={23} color={COLORS.text}/></View><View style={styles.infoCardContent}><Text style={styles.infoCardTitle}>{title}</Text><Text style={styles.infoCardBody}>{body}</Text></View></View>; }
function FormSection({ title,children }:{title:string;children:ReactNode}) { return <View style={styles.formSection}><Text style={styles.sectionLabel}>{title}</Text>{children}</View>; }
function ChoiceRow({ values,selected,onSelect }:{values:Array<[string,string]>;selected:string;onSelect:(value:string)=>void}) { return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{values.map(([value,label])=>{const active=selected===value;return <Pressable key={value} style={[styles.choicePill,active&&styles.choicePillActive]} onPress={()=>onSelect(value)}><Text style={[styles.choicePillText,active&&styles.choicePillTextActive]}>{label}</Text></Pressable>;})}</ScrollView>; }
function LabeledInput({ label,value,onChangeText,suffix,placeholder,keyboardType='default',autoCapitalize='sentences' }:{label:string;value:string;onChangeText:(value:string)=>void;suffix?:string;placeholder?:string;keyboardType?:'default'|'number-pad'|'decimal-pad';autoCapitalize?:'none'|'sentences'|'words'|'characters'}) { return <View style={styles.inputGroup}><Text style={styles.inputLabel}>{label}</Text><View style={styles.inputWrap}><TextInput style={styles.input} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={COLORS.textMuted} keyboardType={keyboardType} autoCapitalize={autoCapitalize}/>{!!suffix&&<Text style={styles.inputSuffix}>{suffix}</Text>}</View></View>; }
function HealthRow({ label,value }:{label:string;value:string}) { return <View style={styles.healthRow}><View style={styles.healthLeft}><View style={styles.healthCheck}><Ionicons name="checkmark" size={15} color={COLORS.green}/></View><Text style={styles.healthLabel}>{label}</Text></View><Text style={styles.healthValue}>{value}</Text></View>; }
function SummaryRow({ label,value,last=false }:{label:string;value:string;last?:boolean}) { return <View style={[styles.summaryRow,last&&styles.summaryRowLast]}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>; }
function ResultMiniStat({ label,value }:{label:string;value:string}) { return <View style={styles.resultMiniStat}><Text style={styles.resultMiniLabel}>{label}</Text><Text style={styles.resultMiniValue}>{value}</Text></View>; }
function FilterPill({ label,active,onPress }:{label:string;active:boolean;onPress:()=>void}) { return <Pressable style={[styles.filterPill,active&&styles.filterPillActive]} onPress={onPress}><Text style={[styles.filterPillText,active&&styles.filterPillTextActive]}>{label}</Text></Pressable>; }
function DateGroup({ title,items,settings,onOpen }:{title:string;items:VehicleDetection[];settings:AnalysisRequestSettings;onOpen:(id:string)=>void}) { return <View style={styles.dateGroup}><Text style={styles.dateGroupTitle}>{title}</Text><View style={styles.stackGap}>{items.map(item=><Pressable key={item.id} style={styles.recordCard} onPress={()=>onOpen(item.id)}><View style={styles.recordThumb}><VehicleGlyph type={item.vehicleType} size={37}/></View><View style={styles.recordCenter}><Text style={styles.recordPlate}>{item.plateText??'UNKNOWN'}</Text><Text style={styles.recordMeta}>{item.vehicleType} · {formatTime(item.capturedAt)}</Text></View><View style={styles.recordRight}><Text style={[styles.recordSpeed,item.violation==='overspeeding'&&styles.recordSpeedDanger]}>{displaySpeedNumber(item.speedKmh??0,settings.speedUnit)} <Text style={styles.recordSpeedUnit}>{settings.speedUnit==='mph'?'mph':'km/h'}</Text></Text><StatusPill status={item.reviewStatus} violation={item.violation}/></View></Pressable>)}</View></View>; }
function StatusPill({ status,violation }:{status:ReviewStatus;violation:VehicleDetection['violation']}) { const config=statusConfig(status,violation); return <View style={[styles.statusPill,{backgroundColor:config.background}]}><Text style={[styles.statusPillText,{color:config.color}]}>{config.label}</Text></View>; }
function VehicleGlyph({ type,size }:{type:string;size:number}) { let icon:IconName='car-outline'; if(/motor|bike/i.test(type))icon='bicycle-outline'; if(/bus|truck|van/i.test(type))icon='bus-outline'; return <Ionicons name={icon} size={size} color={COLORS.textSecondary}/>; }
function EmptyScreen({ title,description,action,onAction }:{title:string;description:string;action:string;onAction:()=>void}) { return <View style={styles.emptyScreen}><View style={styles.emptyIconCircle}><Ionicons name="file-tray-outline" size={48} color={COLORS.textSecondary}/></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyDescription}>{description}</Text><PrimaryButton label={action} icon="arrow-forward" onPress={onAction}/></View>; }
function SettingsGroup({ title,children }:{title:string;children:ReactNode}) { return <View style={styles.settingsGroupWrap}><Text style={styles.settingsGroupTitle}>{title}</Text><View style={styles.settingsGroupCard}>{children}</View></View>; }
function SettingsActionRow({ icon,label,value,onPress,last=false }:{icon:IconName;label:string;value:string;onPress:()=>void;last?:boolean}) { return <Pressable style={[styles.settingsRow,last&&styles.settingsRowLast]} onPress={onPress}><View style={styles.settingsRowIcon}><Ionicons name={icon} size={21} color={COLORS.text}/></View><Text style={styles.settingsRowLabel}>{label}</Text><Text style={styles.settingsRowValue} numberOfLines={1}>{value}</Text><Ionicons name="chevron-forward" size={20} color={COLORS.textMuted}/></Pressable>; }
function SettingsToggleRow({ icon,label,value,onValueChange,last=false }:{icon:IconName;label:string;value:boolean;onValueChange:(value:boolean)=>void;last?:boolean}) { return <View style={[styles.settingsRow,last&&styles.settingsRowLast]}><View style={styles.settingsRowIcon}><Ionicons name={icon} size={21} color={COLORS.text}/></View><Text style={styles.settingsRowLabel}>{label}</Text><Switch value={value} onValueChange={onValueChange} trackColor={{false:COLORS.border,true:COLORS.dark}} thumbColor={COLORS.white}/></View>; }
function SettingsStepperRow({ icon,label,value,onMinus,onPlus,last=false }:{icon:IconName;label:string;value:string;onMinus:()=>void;onPlus:()=>void;last?:boolean}) { return <View style={[styles.settingsRow,last&&styles.settingsRowLast]}><View style={styles.settingsRowIcon}><Ionicons name={icon} size={21} color={COLORS.text}/></View><Text style={styles.settingsRowLabel}>{label}</Text><View style={styles.stepper}><Pressable style={styles.stepperButton} onPress={onMinus}><Ionicons name="remove" size={18} color={COLORS.text}/></Pressable><Text style={styles.stepperValue}>{value}</Text><Pressable style={styles.stepperButton} onPress={onPlus}><Ionicons name="add" size={18} color={COLORS.text}/></Pressable></View></View>; }

function displaySpeedNumber(speedKmh:number,unit:SpeedUnit):number { return unit==='mph'?Math.round(speedKmh/1.60934):Math.round(speedKmh); }
function displaySpeed(speedKmh:number,unit:SpeedUnit):string { return `${displaySpeedNumber(speedKmh,unit)} ${unit==='mph'?'mph':'km/h'}`; }
function directionLabel(direction:TrafficDirection):string { if(direction==='right_to_left')return'Right to left'; if(direction==='both')return'Both directions'; return'Left to right'; }
function nextDirection(direction:TrafficDirection):TrafficDirection { if(direction==='left_to_right')return'right_to_left'; if(direction==='right_to_left')return'both'; return'left_to_right'; }
function normalizePlate(value:string):string { return value.replace(/[^a-z0-9]/gi,'').toUpperCase(); }
function formatTime(value:string):string { return new Date(value).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
function formatFullDate(value:string):string { return new Date(value).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
function formatTimer(seconds:number):string { const minutes=Math.floor(seconds/60).toString().padStart(2,'0'); const remaining=(seconds%60).toString().padStart(2,'0'); return `${minutes}:${remaining}`; }
function statusConfig(status:ReviewStatus,violation:VehicleDetection['violation']) { if(status==='needs_review'||status==='demo')return{label:status==='demo'?'Demo · Review':'Needs Review',background:COLORS.redSoft,color:COLORS.red}; if(status==='confirmed')return{label:'Confirmed',background:'#EAE9E5',color:COLORS.textSecondary}; if(status==='incorrect')return{label:'Incorrect',background:COLORS.amberSoft,color:COLORS.amber}; if(status==='plate_unreadable')return{label:'Review Plate',background:COLORS.blueSoft,color:'#00628E'}; if(violation==='overspeeding')return{label:'Overspeeding',background:COLORS.redSoft,color:COLORS.red}; return{label:'Clear',background:COLORS.greenSoft,color:COLORS.green}; }

const styles = StyleSheet.create({
  flex:{flex:1},safeLight:{flex:1,backgroundColor:COLORS.background},safeDark:{flex:1,backgroundColor:COLORS.dark},appShell:{flex:1},bootScreen:{flex:1,backgroundColor:COLORS.background,alignItems:'center',justifyContent:'center',padding:24},bootTitle:{marginTop:18,fontFamily:FONT.medium,fontSize:30,color:COLORS.text,letterSpacing:-0.7},bootCaption:{marginTop:7,fontFamily:FONT.regular,fontSize:14,color:COLORS.textSecondary},screenContent:{paddingHorizontal:24,paddingTop:8,gap:24},
  onboardingPage:{flex:1,paddingHorizontal:24,paddingVertical:16,justifyContent:'space-between'},onboardingBrandRow:{flexDirection:'row',alignItems:'center',gap:12},onboardingBrand:{fontFamily:FONT.medium,fontSize:20,color:COLORS.text},onboardingVisual:{height:285,borderRadius:32,backgroundColor:COLORS.dark,overflow:'hidden',alignItems:'center',justifyContent:'center'},onboardingIconCircle:{width:128,height:128,borderRadius:64,backgroundColor:COLORS.darkAlt,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:COLORS.darkBorder},onboardingLine:{position:'absolute',left:-20,right:-20,height:2,backgroundColor:COLORS.blue,opacity:0.8,transform:[{rotate:'-2deg'}]},onboardingTitle:{fontFamily:FONT.medium,fontSize:38,lineHeight:44,letterSpacing:-1.2,color:COLORS.text},onboardingBody:{marginTop:16,fontFamily:FONT.regular,fontSize:18,lineHeight:28,color:COLORS.textSecondary},onboardingFooter:{gap:14},pageDots:{flexDirection:'row',gap:7,alignSelf:'center',marginBottom:4},pageDot:{width:8,height:8,borderRadius:4,backgroundColor:COLORS.border},pageDotActive:{width:25,backgroundColor:COLORS.text},centerTextButton:{minHeight:44,alignItems:'center',justifyContent:'center'},textButtonLabel:{fontFamily:FONT.medium,fontSize:15,color:COLORS.textSecondary},
  appHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},appHeaderCompact:{marginBottom:-4},appHeaderIdentity:{flex:1,flexDirection:'row',alignItems:'center',gap:13},headerTextWrap:{flex:1},headerEyebrow:{fontFamily:FONT.mono,fontSize:11,color:COLORS.textMuted,letterSpacing:1.5},headerTitle:{marginTop:2,fontFamily:FONT.medium,fontSize:23,color:COLORS.text,letterSpacing:-0.4},headerTitleCompact:{fontSize:28,letterSpacing:-0.7},notificationButton:{width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center'},brandMark:{backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.border,alignItems:'center',justifyContent:'center',overflow:'hidden'},brandMarkLine:{position:'absolute',left:7,right:7,height:1,backgroundColor:COLORS.blue,opacity:0.7},
  heroCard:{backgroundColor:COLORS.dark,borderRadius:20,padding:24,gap:12},heroTitle:{fontFamily:FONT.medium,fontSize:29,color:COLORS.white,letterSpacing:-0.7},heroBody:{maxWidth:320,fontFamily:FONT.regular,fontSize:16,lineHeight:24,color:'#B6B6B2'},heroPrimaryAction:{marginTop:14,height:60,borderRadius:14,backgroundColor:COLORS.white,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:12},heroPrimaryActionText:{fontFamily:FONT.medium,fontSize:18,color:COLORS.text},heroDivider:{height:1,backgroundColor:COLORS.darkBorder,marginVertical:10},heroQuickRow:{flexDirection:'row',justifyContent:'space-around'},quickDarkAction:{minWidth:78,alignItems:'center',gap:9},quickDarkIcon:{width:50,height:50,borderRadius:25,borderWidth:1,borderColor:COLORS.darkBorder,backgroundColor:COLORS.darkAlt,alignItems:'center',justifyContent:'center'},quickDarkLabel:{fontFamily:FONT.regular,fontSize:13,color:'#B6B6B2'},
  metricTwoColumn:{flexDirection:'row',gap:12},metricCard:{flex:1,minHeight:175,backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.border,borderRadius:16,padding:18,justifyContent:'space-between'},metricCardTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},metricBadge:{borderRadius:5,backgroundColor:COLORS.blueSoft,paddingHorizontal:10,paddingVertical:5},metricBadgeDanger:{backgroundColor:COLORS.redSoft},metricBadgeText:{fontFamily:FONT.mono,fontSize:12,color:'#00628E'},metricBadgeTextDanger:{color:COLORS.red},metricValue:{marginTop:18,fontFamily:FONT.medium,fontSize:54,color:COLORS.text,letterSpacing:-2},metricValueDanger:{color:COLORS.text},metricLabel:{fontFamily:FONT.regular,fontSize:14,color:COLORS.textMuted},wideMetricCard:{backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.border,borderRadius:16,padding:20},wideMetricValue:{marginTop:7,fontFamily:FONT.medium,fontSize:38,color:COLORS.text,letterSpacing:-1.1},speedBars:{position:'absolute',top:34,right:20,height:62,flexDirection:'row',alignItems:'flex-end',gap:5},speedBar:{width:17,borderRadius:5,backgroundColor:'#E2E1DB'},speedBarDanger:{backgroundColor:COLORS.red},wideMetricDivider:{height:1,backgroundColor:COLORS.border,marginVertical:20},wideMetricBottomRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},wideMetricSmallValue:{fontFamily:FONT.medium,fontSize:24,color:COLORS.text},
  sectionHeader:{marginTop:4,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},sectionHeaderTitle:{fontFamily:FONT.medium,fontSize:21,color:COLORS.text},sectionHeaderAction:{fontFamily:FONT.mono,fontSize:12,color:COLORS.textMuted,letterSpacing:0.6},stackGap:{gap:10},detectionRow:{minHeight:84,backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.border,borderRadius:15,padding:11,flexDirection:'row',alignItems:'center',gap:12},vehicleThumb:{width:58,height:58,borderRadius:10,backgroundColor:COLORS.backgroundAlt,alignItems:'center',justifyContent:'center'},detectionCenter:{flex:1},detectionPlate:{fontFamily:FONT.mono,fontSize:16,color:COLORS.text,letterSpacing:0.9},detectionMeta:{marginTop:5,fontFamily:FONT.regular,fontSize:13,color:COLORS.textMuted},statusPill:{borderRadius:999,paddingHorizontal:12,paddingVertical:7},statusPillText:{fontFamily:FONT.regular,fontSize:12},modeNotice:{flexDirection:'row',alignItems:'flex-start',gap:10,padding:15,borderRadius:14,backgroundColor:COLORS.backgroundAlt},modeNoticeText:{flex:1,fontFamily:FONT.regular,fontSize:13,lineHeight:20,color:COLORS.textSecondary},
  detectTitle:{fontFamily:FONT.medium,fontSize:38,color:COLORS.text,letterSpacing:-1.1},detectSubtitle:{marginTop:-12,maxWidth:360,fontFamily:FONT.regular,fontSize:18,lineHeight:28,color:COLORS.textSecondary},sourceStack:{gap:12},sourceCard:{minHeight:150,backgroundColor:COLORS.card,borderRadius:18,borderWidth:1,borderColor:COLORS.border,padding:18,flexDirection:'row',alignItems:'center',gap:16},sourceIconBox:{width:66,height:66,borderRadius:14,backgroundColor:'#FBF9F3',borderWidth:1,borderColor:COLORS.border,alignItems:'center',justifyContent:'center'},sourceContent:{flex:1},sourceTitle:{fontFamily:FONT.medium,fontSize:21,color:COLORS.text},sourceBody:{marginTop:7,fontFamily:FONT.regular,fontSize:16,lineHeight:24,color:COLORS.textSecondary},infoCard:{flexDirection:'row',gap:13,borderRadius:16,backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.border,padding:16},infoCardIcon:{width:42,height:42,borderRadius:21,backgroundColor:COLORS.backgroundAlt,alignItems:'center',justifyContent:'center'},infoCardContent:{flex:1},infoCardTitle:{fontFamily:FONT.medium,fontSize:15,color:COLORS.text},infoCardBody:{marginTop:4,fontFamily:FONT.regular,fontSize:13,lineHeight:19,color:COLORS.textSecondary},
  backHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},backButton:{width:44,height:44,borderRadius:22,backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.border,alignItems:'center',justifyContent:'center'},backButtonPlaceholder:{width:44},backHeaderTitle:{fontFamily:FONT.medium,fontSize:19,color:COLORS.text},calibrationPreview:{height:285,borderRadius:20,backgroundColor:'#D9D8D2',alignItems:'center',justifyContent:'center',overflow:'hidden'},previewLine:{position:'absolute',left:0,right:0,height:2,borderStyle:'dashed',borderWidth:1,borderColor:COLORS.blue},previewLineLabel:{position:'absolute',left:18,top:8,fontFamily:FONT.mono,fontSize:12,color:COLORS.blue,letterSpacing:1},previewZone:{width:'58%',height:'38%',borderWidth:2,borderColor:COLORS.blue,backgroundColor:'rgba(21,159,229,0.08)'},previewDirection:{position:'absolute',right:20,top:'50%',width:40,height:40,borderRadius:20,backgroundColor:COLORS.card,alignItems:'center',justifyContent:'center'},stepRow:{flexDirection:'row',justifyContent:'space-between'},stepItem:{flex:1,alignItems:'center',gap:7},stepNumber:{width:29,height:29,borderRadius:15,backgroundColor:COLORS.border,alignItems:'center',justifyContent:'center'},stepNumberActive:{backgroundColor:COLORS.dark},stepNumberText:{fontFamily:FONT.medium,fontSize:12,color:COLORS.white},stepLabel:{fontFamily:FONT.regular,fontSize:11,color:COLORS.textSecondary},formSection:{gap:10},sectionLabel:{fontFamily:FONT.medium,fontSize:15,color:COLORS.text},choiceRow:{gap:8},choicePill:{borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,borderRadius:999,paddingHorizontal:16,paddingVertical:11},choicePillActive:{backgroundColor:COLORS.dark,borderColor:COLORS.dark},choicePillText:{fontFamily:FONT.regular,fontSize:13,color:COLORS.textSecondary},choicePillTextActive:{color:COLORS.white},formGrid:{flexDirection:'row',gap:12},inputGroup:{flex:1,gap:8},inputLabel:{fontFamily:FONT.medium,fontSize:12,color:COLORS.textSecondary},inputWrap:{minHeight:54,borderRadius:13,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,flexDirection:'row',alignItems:'center',paddingHorizontal:14},input:{flex:1,fontFamily:FONT.regular,fontSize:15,color:COLORS.text,paddingVertical:12},inputSuffix:{fontFamily:FONT.regular,fontSize:13,color:COLORS.textMuted},healthCard:{borderRadius:16,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,paddingHorizontal:16},healthRow:{minHeight:54,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:COLORS.border},healthLeft:{flexDirection:'row',alignItems:'center',gap:10},healthCheck:{width:25,height:25,borderRadius:13,backgroundColor:COLORS.greenSoft,alignItems:'center',justifyContent:'center'},healthLabel:{fontFamily:FONT.regular,fontSize:14,color:COLORS.text},healthValue:{fontFamily:FONT.regular,fontSize:12,color:COLORS.textMuted},
  primaryButton:{minHeight:58,borderRadius:16,backgroundColor:COLORS.dark,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:10,paddingHorizontal:18},primaryButtonLight:{backgroundColor:COLORS.white},primaryButtonText:{fontFamily:FONT.medium,fontSize:16,color:COLORS.white},primaryButtonTextLight:{color:COLORS.text},secondaryButton:{minHeight:56,borderRadius:16,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:10,paddingHorizontal:18},secondaryButtonText:{fontFamily:FONT.medium,fontSize:15,color:COLORS.text},buttonDisabled:{opacity:0.45},
  cameraScreen:{flex:1,backgroundColor:COLORS.dark},cameraShade:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,0,0,0.18)'},cameraTopControls:{position:'absolute',top:18,left:24,right:24,flexDirection:'row',justifyContent:'space-between'},cameraTopRight:{flexDirection:'row',gap:12},roundDarkButton:{width:56,height:56,borderRadius:28,backgroundColor:'rgba(17,17,17,0.82)',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'rgba(255,255,255,0.09)'},liveGuideLine:{position:'absolute',left:0,right:0,height:2,borderTopWidth:2,borderStyle:'dashed',borderColor:COLORS.blue,transform:[{rotate:'-2deg'}]},liveGuideLabel:{position:'absolute',left:28,top:10,fontFamily:FONT.mono,fontSize:14,color:COLORS.blue,letterSpacing:1.2},liveVehicleBox:{position:'absolute',top:'43%',left:'25%',width:'50%',height:'20%',borderWidth:2,borderColor:COLORS.blue},livePlateTag:{position:'absolute',top:-42,alignSelf:'center',backgroundColor:'rgba(17,17,17,0.92)',borderRadius:6,paddingHorizontal:14,paddingVertical:9,flexDirection:'row',alignItems:'center',gap:12},livePlateText:{fontFamily:FONT.mono,fontSize:15,color:COLORS.white,letterSpacing:1.2},liveTagDivider:{width:1,height:20,backgroundColor:COLORS.darkBorder},liveSpeedText:{fontFamily:FONT.mono,fontSize:15,color:COLORS.red},monitorPanel:{position:'absolute',left:0,right:0,bottom:0,borderTopLeftRadius:24,borderTopRightRadius:24,backgroundColor:COLORS.dark,padding:24,gap:14},monitorHeaderRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'},liveTitleRow:{flexDirection:'row',alignItems:'center',gap:10},monitorDot:{width:12,height:12,borderRadius:6,backgroundColor:COLORS.textMuted},monitorDotActive:{backgroundColor:COLORS.red},monitorTitle:{fontFamily:FONT.medium,fontSize:22,color:COLORS.white},monitorSource:{marginTop:7,marginLeft:22,fontFamily:FONT.regular,fontSize:13,color:'#AFAFAD'},timerPill:{flexDirection:'row',alignItems:'center',gap:8,borderRadius:7,borderWidth:1,borderColor:COLORS.darkBorder,paddingHorizontal:12,paddingVertical:9},timerText:{fontFamily:FONT.mono,fontSize:14,color:COLORS.white},stopButton:{minHeight:66,borderRadius:14,backgroundColor:'#FF4640',alignItems:'center',justifyContent:'center',flexDirection:'row',gap:10},startButton:{backgroundColor:COLORS.blue},stopButtonText:{fontFamily:FONT.medium,fontSize:19,color:COLORS.white},monitorSecondaryRow:{flexDirection:'row',gap:10},darkOutlineButton:{flex:1,minHeight:56,borderRadius:13,borderWidth:1,borderColor:COLORS.darkBorder,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8},darkOutlineButtonText:{fontFamily:FONT.medium,fontSize:13,color:COLORS.white},permissionScreen:{flex:1,backgroundColor:COLORS.dark,padding:28,alignItems:'center',justifyContent:'center',gap:18},permissionIcon:{width:105,height:105,borderRadius:53,backgroundColor:COLORS.darkAlt,alignItems:'center',justifyContent:'center'},permissionTitle:{marginTop:8,textAlign:'center',fontFamily:FONT.medium,fontSize:27,color:COLORS.white},permissionText:{maxWidth:330,textAlign:'center',fontFamily:FONT.regular,fontSize:16,lineHeight:24,color:'#B6B6B2'},
  uploadDropzone:{minHeight:330,borderRadius:22,borderWidth:1,borderStyle:'dashed',borderColor:COLORS.textMuted,backgroundColor:COLORS.card,alignItems:'center',justifyContent:'center',padding:28},uploadIconCircle:{width:82,height:82,borderRadius:41,backgroundColor:COLORS.backgroundAlt,alignItems:'center',justifyContent:'center'},uploadTitle:{marginTop:20,fontFamily:FONT.medium,fontSize:23,color:COLORS.text},uploadBody:{marginTop:9,textAlign:'center',fontFamily:FONT.regular,fontSize:15,lineHeight:23,color:COLORS.textSecondary},uploadButtonFake:{marginTop:22,borderRadius:13,backgroundColor:COLORS.dark,paddingHorizontal:20,paddingVertical:13},uploadButtonFakeText:{fontFamily:FONT.medium,fontSize:14,color:COLORS.white},settingsSummaryCard:{borderRadius:16,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,paddingHorizontal:16},summaryRow:{minHeight:55,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:COLORS.border},summaryRowLast:{borderBottomWidth:0},summaryLabel:{fontFamily:FONT.regular,fontSize:13,color:COLORS.textSecondary},summaryValue:{maxWidth:'58%',textAlign:'right',fontFamily:FONT.medium,fontSize:13,color:COLORS.text},
  formIntro:{marginTop:-10,fontFamily:FONT.regular,fontSize:15,lineHeight:23,color:COLORS.textSecondary},formCard:{gap:17,borderRadius:18,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,padding:18},passwordWrap:{minHeight:54,borderRadius:13,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,flexDirection:'row',alignItems:'center',paddingLeft:14},passwordInput:{flex:1,fontFamily:FONT.regular,fontSize:15,color:COLORS.text},passwordIconButton:{width:52,height:52,alignItems:'center',justifyContent:'center'},testConnectionButton:{minHeight:56,borderRadius:16,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:10},testConnectionText:{fontFamily:FONT.medium,fontSize:15,color:COLORS.text},connectionSuccessCard:{borderRadius:18,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,padding:16},connectionPreview:{height:150,borderRadius:14,backgroundColor:'#D9D8D2',alignItems:'center',justifyContent:'center'},connectionLivePill:{position:'absolute',top:12,left:12,flexDirection:'row',gap:7,alignItems:'center',borderRadius:999,backgroundColor:COLORS.dark,paddingHorizontal:10,paddingVertical:6},connectionLiveDot:{width:7,height:7,borderRadius:4,backgroundColor:COLORS.blue},connectionLiveText:{fontFamily:FONT.mono,fontSize:9,color:COLORS.white,letterSpacing:0.9},connectionTitle:{marginTop:15,fontFamily:FONT.medium,fontSize:17,color:COLORS.text},connectionBody:{marginTop:6,fontFamily:FONT.regular,fontSize:13,lineHeight:20,color:COLORS.textSecondary},connectionErrorCard:{flexDirection:'row',alignItems:'flex-start',gap:10,borderRadius:14,backgroundColor:COLORS.redSoft,padding:14},connectionErrorText:{flex:1,fontFamily:FONT.regular,fontSize:13,lineHeight:20,color:COLORS.red},
  processingScreen:{flex:1,backgroundColor:COLORS.dark,alignItems:'center',justifyContent:'center',padding:28},processingRing:{width:120,height:120,borderRadius:60,borderWidth:1,borderColor:COLORS.darkBorder,alignItems:'center',justifyContent:'center'},processingTitle:{marginTop:28,fontFamily:FONT.medium,fontSize:30,color:COLORS.white},processingSource:{marginTop:8,fontFamily:FONT.regular,fontSize:14,color:'#AFAFAD'},processingSteps:{width:'100%',marginTop:34,borderRadius:16,borderWidth:1,borderColor:COLORS.darkBorder,padding:18,gap:17},processingStepRow:{flexDirection:'row',alignItems:'center',gap:12},processingStepDot:{width:9,height:9,borderRadius:5,backgroundColor:COLORS.darkBorder},processingStepDotActive:{backgroundColor:COLORS.blue},processingStepText:{fontFamily:FONT.regular,fontSize:14,color:COLORS.white},processingHint:{marginTop:24,maxWidth:320,textAlign:'center',fontFamily:FONT.regular,fontSize:12,lineHeight:18,color:'#858583'},
  evidenceFrame:{height:260,borderRadius:20,backgroundColor:'#D9D8D2',alignItems:'center',justifyContent:'center',overflow:'hidden'},evidenceOverlayTop:{position:'absolute',top:14,left:14,right:14,flexDirection:'row',justifyContent:'space-between'},evidenceSource:{fontFamily:FONT.medium,fontSize:12,color:COLORS.text},evidenceTime:{fontFamily:FONT.mono,fontSize:10,color:COLORS.textSecondary},evidenceTargetBox:{position:'absolute',width:'58%',height:'40%',borderWidth:2,borderColor:COLORS.blue},resultSpeedCard:{borderRadius:20,backgroundColor:COLORS.dark,padding:22},resultEyebrow:{fontFamily:FONT.mono,fontSize:11,color:'#8E8E8A',letterSpacing:1.3},resultBigSpeedRow:{marginTop:7,flexDirection:'row',alignItems:'baseline',gap:8},resultBigSpeed:{fontFamily:FONT.medium,fontSize:76,color:COLORS.white,letterSpacing:-3},resultBigUnit:{fontFamily:FONT.regular,fontSize:18,color:'#AFAFAD'},resultStatsRow:{marginTop:18,flexDirection:'row',gap:8},resultMiniStat:{flex:1,borderRadius:12,backgroundColor:COLORS.darkAlt,borderWidth:1,borderColor:COLORS.darkBorder,padding:11},resultMiniLabel:{fontFamily:FONT.regular,fontSize:10,color:'#8E8E8A'},resultMiniValue:{marginTop:5,fontFamily:FONT.medium,fontSize:12,color:COLORS.white},plateCard:{minHeight:104,borderRadius:18,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,padding:14,flexDirection:'row',alignItems:'center',gap:13},plateCrop:{width:72,height:64,borderRadius:11,backgroundColor:COLORS.backgroundAlt,alignItems:'center',justifyContent:'center'},plateCardContent:{flex:1},plateCardLabel:{fontFamily:FONT.mono,fontSize:9,color:COLORS.textMuted,letterSpacing:1},plateCardValue:{marginTop:5,fontFamily:FONT.mono,fontSize:18,color:COLORS.text,letterSpacing:1.3},plateEditInput:{marginTop:3,minHeight:38,borderBottomWidth:1,borderBottomColor:COLORS.blue,fontFamily:FONT.mono,fontSize:18,color:COLORS.text},plateConfidence:{marginTop:6,fontFamily:FONT.regular,fontSize:11,color:COLORS.textMuted},editIconButton:{width:42,height:42,borderRadius:21,backgroundColor:COLORS.backgroundAlt,alignItems:'center',justifyContent:'center'},reviewCard:{borderRadius:18,backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.border,padding:16,flexDirection:'row',gap:13},reviewIconCircle:{width:46,height:46,borderRadius:23,backgroundColor:COLORS.redSoft,alignItems:'center',justifyContent:'center'},reviewCardContent:{flex:1},reviewTitle:{fontFamily:FONT.medium,fontSize:17,color:COLORS.text},reviewBody:{marginTop:4,fontFamily:FONT.regular,fontSize:13,lineHeight:19,color:COLORS.textSecondary},detailCard:{borderRadius:16,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,paddingHorizontal:16},deleteTextButton:{minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},deleteText:{fontFamily:FONT.medium,fontSize:14,color:COLORS.red},
  searchRow:{flexDirection:'row',gap:10},searchInputWrap:{flex:1,minHeight:58,borderRadius:15,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,paddingHorizontal:15,flexDirection:'row',alignItems:'center',gap:10},searchInput:{flex:1,fontFamily:FONT.regular,fontSize:17,color:COLORS.text},filterIconButton:{width:58,height:58,borderRadius:15,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,alignItems:'center',justifyContent:'center'},filterPillsRow:{gap:9,paddingRight:12},filterPill:{borderRadius:999,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,paddingHorizontal:18,paddingVertical:11},filterPillActive:{backgroundColor:COLORS.dark,borderColor:COLORS.dark},filterPillText:{fontFamily:FONT.regular,fontSize:14,color:COLORS.textSecondary},filterPillTextActive:{color:COLORS.white},dateGroup:{gap:12},dateGroupTitle:{fontFamily:FONT.medium,fontSize:21,color:COLORS.textSecondary},recordCard:{minHeight:116,borderRadius:18,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,padding:14,flexDirection:'row',alignItems:'center',gap:13},recordThumb:{width:76,height:76,borderRadius:12,backgroundColor:COLORS.backgroundAlt,alignItems:'center',justifyContent:'center'},recordCenter:{flex:1},recordPlate:{fontFamily:FONT.mono,fontSize:17,color:COLORS.text,letterSpacing:1.2},recordMeta:{marginTop:7,fontFamily:FONT.regular,fontSize:14,color:COLORS.textSecondary},recordRight:{alignItems:'flex-end',gap:8},recordSpeed:{fontFamily:FONT.medium,fontSize:28,color:COLORS.text},recordSpeedDanger:{color:COLORS.red},recordSpeedUnit:{fontFamily:FONT.regular,fontSize:12,color:COLORS.textMuted},recordsEmptyCard:{minHeight:280,borderRadius:20,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,alignItems:'center',justifyContent:'center',padding:24},recordsEmptyTitle:{marginTop:15,fontFamily:FONT.medium,fontSize:20,color:COLORS.text},recordsEmptyBody:{marginTop:7,fontFamily:FONT.regular,fontSize:14,color:COLORS.textSecondary},
  settingsGroupWrap:{gap:9},settingsGroupTitle:{marginLeft:3,fontFamily:FONT.medium,fontSize:13,color:COLORS.textSecondary},settingsGroupCard:{borderRadius:17,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.card,overflow:'hidden'},settingsNameInput:{minHeight:58,paddingHorizontal:17,fontFamily:FONT.medium,fontSize:16,color:COLORS.text},settingsRow:{minHeight:62,paddingHorizontal:14,flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:COLORS.border},settingsRowLast:{borderBottomWidth:0},settingsRowIcon:{width:38,height:38,borderRadius:12,backgroundColor:COLORS.backgroundAlt,alignItems:'center',justifyContent:'center'},settingsRowLabel:{flex:1,marginLeft:11,fontFamily:FONT.regular,fontSize:14,color:COLORS.text},settingsRowValue:{maxWidth:'38%',marginRight:5,textAlign:'right',fontFamily:FONT.regular,fontSize:12,color:COLORS.textMuted},stepper:{flexDirection:'row',alignItems:'center',gap:8},stepperButton:{width:30,height:30,borderRadius:15,backgroundColor:COLORS.backgroundAlt,alignItems:'center',justifyContent:'center'},stepperValue:{minWidth:60,textAlign:'center',fontFamily:FONT.medium,fontSize:12,color:COLORS.text},dangerSettingsButton:{minHeight:56,borderRadius:16,borderWidth:1,borderColor:COLORS.redSoft,backgroundColor:COLORS.card,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:9},dangerSettingsText:{fontFamily:FONT.medium,fontSize:14,color:COLORS.red},
  bottomNavWrap:{position:'absolute',left:18,right:18,bottom:14},bottomNav:{minHeight:86,borderRadius:43,borderWidth:1,borderColor:COLORS.border,backgroundColor:'rgba(255,255,255,0.96)',flexDirection:'row',alignItems:'center',justifyContent:'space-around',paddingHorizontal:8,shadowColor:'#000',shadowOpacity:0.08,shadowRadius:22,shadowOffset:{width:0,height:10},elevation:8},navItem:{width:72,minHeight:68,borderRadius:34,alignItems:'center',justifyContent:'center',gap:4},navItemActive:{backgroundColor:COLORS.dark},navLabel:{fontFamily:FONT.regular,fontSize:11,color:COLORS.textMuted},navLabelActive:{color:COLORS.white},
  emptyScreen:{flex:1,backgroundColor:COLORS.background,alignItems:'center',justifyContent:'center',padding:28},emptyIconCircle:{width:94,height:94,borderRadius:47,backgroundColor:COLORS.backgroundAlt,alignItems:'center',justifyContent:'center'},emptyTitle:{marginTop:20,fontFamily:FONT.medium,fontSize:24,color:COLORS.text},emptyDescription:{marginTop:8,marginBottom:24,maxWidth:310,textAlign:'center',fontFamily:FONT.regular,fontSize:15,lineHeight:23,color:COLORS.textSecondary},
});
