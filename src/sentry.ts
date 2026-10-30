import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { scrubBreadcrumb, scrubEvent } from './core/sentryScrub';

// Crash & error reporting only. DSN is injected at build time (GRABBIT_SENTRY_DSN), never committed.
const dsn: string = ((Constants.expoConfig?.extra as any)?.sentryDsn || '').trim();
export const sentryEnabled = !!dsn && !__DEV__;

if (sentryEnabled) {
  Sentry.init({
    dsn,
    release: `grabbit@${Constants.expoConfig?.version ?? 'unknown'}`,
    environment: 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    enableAutoPerformanceTracing: false,
    enableAppStartTracking: false,
    enableNativeFramesTracking: false,
    enableStallTracking: false,
    enableUserInteractionTracing: false,
    profilesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    enableAutoSessionTracking: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    maxBreadcrumbs: 20,
    integrations: (defaults) => defaults.filter((i) => !/Replay|Tracing|Profiling|Feedback|Spotlight/i.test(i.name)),
    beforeBreadcrumb: (b) => scrubBreadcrumb(b as any),
    beforeSend: (e) => scrubEvent(e as any),
  });
}

export function wrapRoot<P extends Record<string, unknown>>(C: React.ComponentType<P>): React.ComponentType<P> {
  return sentryEnabled ? (Sentry.wrap(C as any) as any) : C;
}
