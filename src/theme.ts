import { Platform } from 'react-native';

export const COLORS = {
  background: '#F5F5F2',
  backgroundAlt: '#EFEFED',
  card: '#FFFFFF',
  text: '#101010',
  textSecondary: '#777772',
  textMuted: '#A3A39E',
  dark: '#111111',
  darkAlt: '#1C1C1C',
  darkBorder: '#343434',
  border: '#E4E4E0',
  blue: '#159FE5',
  blueSoft: '#E1F2FC',
  red: '#C91318',
  redSoft: '#FCE5E6',
  amber: '#9A6500',
  amberSoft: '#FFF0D1',
  green: '#1E7D4D',
  greenSoft: '#DFF2E8',
  white: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.62)',
} as const;

export const FONT = {
  regular: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }),
  medium: Platform.select({ ios: 'System', android: 'sans-serif-medium', default: 'System' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;
