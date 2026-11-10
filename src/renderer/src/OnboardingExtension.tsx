import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Calculator,
  Check,
  Clipboard,
  FileText,
  FolderOpen,
  Keyboard,
  Mic,
  Shield,
  Volume2,
} from 'lucide-react';
import HotkeyRecorder from './settings/HotkeyRecorder';
import { useI18n } from './i18n';
import supercmdLogo from '../../../supercmd.png';
import onboardingIconVideo from '../../../assets/icon.mp4';

interface OnboardingExtensionProps {
  initialShortcut: string;
  requireWorkingShortcut?: boolean;

  onboardingHotkeyPresses?: number;
  onComplete: () => void;
  onClose: () => void;
}

type PermissionTargetId = 'accessibility' | 'input-monitoring' | 'home-folder';

const STEPS = [
  'Welcome',
  'Core Features',
  'Hotkey Setup',
  'Permissions',
  'Final Check',
];

function getFeatureCards(t: (key: string) => string) {
  return [
    { id: 'clipboard', title: 'Clipboard', description: 'Search and paste history instantly.', icon: Clipboard },
    { id: 'snippet', title: 'Snippet', description: 'Store reusable text with quick triggers.', icon: FileText },

    { id: 'global-ai-prompt', title: 'Global AI Prompt', description: 'Transform text from anywhere.', icon: Bot },
    { id: 'unit-conversion', title: 'Unit Conversion', description: 'Convert values directly in launcher.', icon: Calculator },
  ];
}

function getPermissionTargets(t: (key: string) => string): Array<{
  id: PermissionTargetId;
  title: string;
  description: string;
  url: string;
  icon: any;
  iconTone: string;
  iconBg: string;
}> {
  return [
  {
    id: 'home-folder',
    title: 'Home Folder',
    description: 'Required for file search.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
    icon: FolderOpen,
    iconTone: 'text-blue-100',
    iconBg: 'bg-blue-500/22 border-blue-100/30',
  },
  {
    id: 'accessibility',
    title: 'Accessibility',
    description: 'Required for text selection, keyboard automation, and reliable typing into other apps.',
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    icon: Shield,
    iconTone: 'text-rose-100',
    iconBg: 'bg-rose-500/22 border-rose-100/30',
  },
  {
    id: 'input-monitoring',
    title: t('onboarding.setup.permissions.inputMonitoringTitle'),
    description: t('onboarding.setup.permissions.inputMonitoringDescription'),
    url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
    icon: Keyboard,
    iconTone: 'text-amber-100',
    iconBg: 'bg-amber-500/22 border-amber-100/30',
  },

  ];
}

function toHotkeyCaps(shortcut: string): string[] {
  const map: Record<string, string> = {
    Command: '\u2318',
    Control: '\u2303',
    Alt: '\u2325',
    Shift: '\u21E7',
    Space: 'Space',
    Return: 'Enter',
    Fn: 'fn',
  };
  return String(shortcut || '')
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => map[token] || (token.length === 1 ? token.toUpperCase() : token));
}

const OnboardingExtension: React.FC<OnboardingExtensionProps> = ({
  initialShortcut,
  requireWorkingShortcut = false,

  onboardingHotkeyPresses = 0,
  onComplete,
  onClose,
}) => {
  const { t } = useI18n();
  const featureCards = useMemo(() => getFeatureCards(t), [t]);
  const permissionTargets = useMemo(() => getPermissionTargets(t), [t]);

  const [step, setStep] = useState(0);
  const [shortcut, setShortcut] = useState(initialShortcut || 'Alt+Space');
  const [shortcutStatus, setShortcutStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [hasValidShortcut, setHasValidShortcut] = useState(!requireWorkingShortcut);
  const [openedPermissions, setOpenedPermissions] = useState<Record<string, boolean>>({});
  const [requestedPermissions, setRequestedPermissions] = useState<Record<string, boolean>>({});
  const [permissionLoading, setPermissionLoading] = useState<Record<string, boolean>>({});
  const [permissionNotes, setPermissionNotes] = useState<Record<string, string>>({});
  const [openAtLogin, setOpenAtLogin] = useState(true);

  const introVideoRef = useRef<HTMLVideoElement | null>(null);
  const openedPermissionsRef = useRef<Record<string, boolean>>({});
  const requestedPermissionsRef = useRef<Record<string, boolean>>({});
  const finalStepHotkeyBaselineRef = useRef(0);

  useEffect(() => {
    openedPermissionsRef.current = openedPermissions;
  }, [openedPermissions]);

  useEffect(() => {
    requestedPermissionsRef.current = requestedPermissions;
  }, [requestedPermissions]);

  useEffect(() => {
    setHasValidShortcut(!requireWorkingShortcut);
  }, [requireWorkingShortcut]);

  // Step 4: auto-download the appropriate model

  // Apply the default openAtLogin preference when the user first reaches the hotkey step.
  useEffect(() => {
    if (step !== 2) return;
    void window.electron.setOpenAtLogin(openAtLogin);
  }, [step === 2]);

  // Fix 4: Auto-refresh permission statuses when user returns from System Settings.
  useEffect(() => {
    if (step !== 3) return;
    const checkPermissions = async () => {
      try {
        const statuses = await window.electron.checkOnboardingPermissions();
        setOpenedPermissions((prev) => {
          const next = { ...prev };
          for (const [id, granted] of Object.entries(statuses)) {
            if (!granted) continue;
            // Avoid auto-marking Input Monitoring unless the user has already
            // initiated that row in onboarding.
            if (
              id === 'input-monitoring' &&
              !openedPermissionsRef.current[id] &&
              !requestedPermissionsRef.current[id]
            ) {
              continue;
            }
            next[id] = true;
          }
          return next;
        });
        setRequestedPermissions((prev) => {
          const next = { ...prev };
          for (const [id, granted] of Object.entries(statuses)) {
            if (!granted) continue;
            if (
              id === 'input-monitoring' &&
              !openedPermissionsRef.current[id] &&
              !requestedPermissionsRef.current[id]
            ) {
              continue;
            }
            next[id] = true;
          }
          return next;
        });
      } catch {}
    };
    void checkPermissions();
    const handleFocus = () => { void checkPermissions(); };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [step]);

  useEffect(() => {
    const video = introVideoRef.current;
    if (!video) return;
    let reverseRaf = 0;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const stopReverse = () => {
      if (reverseRaf) {
        cancelAnimationFrame(reverseRaf);
        reverseRaf = 0;
      }
    };
    const stopHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };

    const reverseTick = () => {
      if (disposed) return;
      const current = introVideoRef.current;
      if (!current) return;
      if (current.currentTime <= 0.04) {
        current.currentTime = 0;
        void current.play().catch(() => {});
        return;
      }
      current.currentTime = Math.max(0, current.currentTime - 1 / 30);
      reverseRaf = requestAnimationFrame(reverseTick);
    };

    const onEnded = () => {
      stopReverse();
      stopHold();
      video.pause();
      holdTimer = setTimeout(() => {
        reverseRaf = requestAnimationFrame(reverseTick);
      }, 450);
    };

    video.addEventListener('ended', onEnded);
    return () => {
      disposed = true;
      stopReverse();
      stopHold();
      video.removeEventListener('ended', onEnded);
    };
  }, []);

  useEffect(() => {
    if (step !== STEPS.length - 1) return;
    finalStepHotkeyBaselineRef.current = onboardingHotkeyPresses;
  }, [step]);

  useEffect(() => {
    if (step !== STEPS.length - 1) return;
    if (onboardingHotkeyPresses <= finalStepHotkeyBaselineRef.current) return;
    onComplete();
  }, [onboardingHotkeyPresses, step, onComplete]);

  // Clear any lingering text selection when the user navigates between steps.
  // when the user continues to the Final Check step.
  useEffect(() => {
    try {
      window.getSelection()?.removeAllRanges();
    } catch {}
  }, [step]);

  const localizedSteps = useMemo(() => ([
    t('onboarding.setup.steps.welcome'),
    t('onboarding.setup.steps.coreFeatures'),
    t('onboarding.setup.steps.hotkeySetup'),
    t('onboarding.setup.steps.permissions'),

    t('onboarding.setup.steps.finalCheck'),
  ]), [t]);
  const stepTitle = useMemo(() => localizedSteps[step] || localizedSteps[0], [localizedSteps, step]);
  const hotkeyCaps = useMemo(() => toHotkeyCaps(shortcut || 'Alt+Space'), [shortcut]);

  const handleShortcutChange = async (nextShortcut: string) => {
    setShortcutStatus('idle');
    setShortcut(nextShortcut);
    if (!nextShortcut) {
      setHasValidShortcut(false);
      return;
    }
    const ok = await window.electron.updateGlobalShortcut(nextShortcut);
    if (ok) {
      setHasValidShortcut(true);
      setShortcutStatus('success');
      setTimeout(() => setShortcutStatus('idle'), 1600);
      return;
    }
    setHasValidShortcut(false);
    setShortcutStatus('error');
    setTimeout(() => setShortcutStatus('idle'), 2200);
  };

  const openPermissionTarget = async (id: PermissionTargetId, url: string) => {
    setPermissionLoading((prev) => ({ ...prev, [id]: true }));
    setPermissionNotes((prev) => ({ ...prev, [id]: '' }));
    try {
      // Re-assert onboarding mode before requesting permission so the window
      // doesn't hide when macOS permission dialogs steal focus.
      try { await window.electron.setLauncherMode('onboarding'); } catch {}
      const result = await window.electron.onboardingRequestPermission(id);
      let granted = Boolean(result?.granted);
      let requested = Boolean(result?.requested);
      const mode = String(result?.mode || '');
      let status = String(result?.status || '');
      let latestError = String(result?.error || '').trim();
      if (requested) {
        setRequestedPermissions((prev) => ({ ...prev, [id]: true }));
      }
      if (granted) {
        setOpenedPermissions((prev) => ({ ...prev, [id]: true }));
      }

      if (requested) {
        setRequestedPermissions((prev) => ({ ...prev, [id]: true }));
      }
      if (granted) {
        setOpenedPermissions((prev) => ({ ...prev, [id]: true }));
        setPermissionNotes((prev) => ({ ...prev, [id]: '' }));
      } else if (id === 'home-folder') {
        if (latestError) {
          setPermissionNotes((prev) => ({ ...prev, [id]: latestError }));
        } else if (!requested || mode === 'manual' || status === 'not-determined') {
          setPermissionNotes((prev) => ({
            ...prev,
            [id]: t('onboarding.setup.permissionNotes.homeFolder'),
          }));
        }
      }

      // Only open Privacy & Security for input-monitoring (requires manual "+" to add app).
      // All other permissions show a native dialog and don't need the system settings panel.
      if (id === 'input-monitoring') {
        const candidateUrls = [
          url,
          'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ListenEvent',
        ];
        try {
          await window.electron.setLauncherMode('onboarding');
        } catch {}
        let ok = false;
        for (const candidate of candidateUrls) {
          if (ok) break;
          ok = await window.electron.openUrl(candidate);
        }
        if (ok) {
          // macOS 13+ does not auto-add apps to Input Monitoring via CGEventTap.
          // The user must click "+" in System Settings and manually select SuperCmd.
          setPermissionNotes((prev) => ({
            ...prev,
            [id]: t('onboarding.setup.permissionNotes.inputMonitoring'),
          }));
        }
      }
    } finally {
      setPermissionLoading((prev) => ({ ...prev, [id]: false }));
      // Re-assert onboarding mode after permission dialog closes so the window
      // comes back to front if macOS pushed it behind during the dialog.
      try { await window.electron.setLauncherMode('onboarding'); } catch {}
    }
  };

  const canCompleteOnboarding = hasValidShortcut;
  const canContinue = step !== 2 || canCompleteOnboarding;
  const canFinish = canCompleteOnboarding;
  const contentBackground = step === 0
    ? 'var(--onboarding-content-bg-step0)'
    : 'var(--onboarding-content-bg-default)';

  return (
    <div className="w-full h-full onboarding-flow">
      <div
        className="glass-effect overflow-hidden h-full flex flex-col"
        style={{
          background: 'var(--onboarding-shell-bg)',
          WebkitBackdropFilter: 'blur(50px) saturate(165%)',
          backdropFilter: 'blur(50px) saturate(165%)',
        }}
      >
        <div className="flex items-center gap-3 px-6 py-4 border-b border-white/[0.05]">
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/75 transition-colors p-0.5"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-white/92 text-[15px] font-medium truncate">{stepTitle}</div>
            <div className="text-white/38 text-xs">Step {step + 1} of {STEPS.length}</div>
          </div>
          <div className="w-[74px]" />
        </div>

        <div
          className="flex-1 overflow-hidden px-6 py-5"
          style={{
            background: contentBackground,
          }}
        >
          {step === 0 && (
            <div className="max-w-6xl mx-auto min-h-full flex items-center">
              <div className="grid grid-cols-1 lg:grid-cols-[430px_minmax(0,1fr)] gap-5 w-full items-center">
                <div
                  className="relative w-full aspect-square rounded-3xl overflow-hidden border border-white/[0.10]"
                  style={{
                    background: 'var(--onboarding-video-bg)',
                    boxShadow: 'var(--onboarding-video-shadow)',
                  }}
                >
                  <video
                    ref={introVideoRef}
                    src={onboardingIconVideo}
                    className="w-full h-full object-cover"
                    autoPlay
                    muted
                    playsInline
                  />
                </div>

                <div
                  className="relative rounded-3xl border border-white/[0.10] p-5 lg:p-6 flex flex-col gap-4 lg:h-[430px] self-center"
                  style={{
                    background: 'var(--onboarding-panel-bg)',
                    boxShadow: 'var(--onboarding-panel-shadow)',
                  }}
                >
                  <span className="inline-flex w-fit px-2.5 py-1 rounded-full border border-white/[0.12] bg-white/[0.06] text-[10px] tracking-[0.14em] uppercase text-white/82">
                    SuperCmd Setup
                  </span>
                  <h2 className="text-white text-[26px] lg:text-[30px] leading-[1.1] font-semibold max-w-xl">
                    {t('onboarding.setup.setupTitle')}
                  </h2>
                  <p className="text-white/72 text-[15px] leading-relaxed max-w-xl">
                    {t('onboarding.setup.setupDescription')}
                  </p>
                  <div className="rounded-2xl border border-white/[0.07] bg-black/24 px-4 py-3">
                    <p className="text-white/88 text-sm mb-2">{t('onboarding.setup.summary.title')}</p>
                    <div className="text-white/72 text-sm space-y-1">
                      <p>{t('onboarding.setup.summary.hotkey')}</p>
                      <p>{t('onboarding.setup.summary.permissions')}</p>
                      <p>3. {t('onboarding.setup.setupSummary')}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="max-w-6xl mx-auto h-full">
              <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-5 min-h-[460px]">
                <div className="p-2 flex items-center justify-center">
                  <img
                    src={supercmdLogo}
                    alt="SuperCmd logo"
                    className="w-full max-w-[240px] h-auto object-contain drop-shadow-[0_22px_54px_rgba(255,58,98,0.68)]"
                    draggable={false}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {featureCards.map((feature) => {
                    const Icon = feature.icon;
                    return (
                      <div
                        key={feature.id}
                        className="group rounded-2xl border border-white/[0.08] p-4 transition-all duration-200 hover:translate-y-[-1px] hover:border-white/[0.14] hover:bg-white/[0.09]"
                        style={{
                          background: 'var(--onboarding-feature-card-bg)',
                          boxShadow: 'var(--onboarding-feature-card-shadow)',
                        }}
                      >
                        <div className="w-8 h-8 rounded-lg border border-white/[0.14] bg-white/10 flex items-center justify-center mb-2.5">
                          <Icon className="w-4 h-4 text-white/92" />
                        </div>
                        <p className="text-white/92 text-sm font-medium mb-1">
                          {feature.title}
                        </p>
                        <p className="text-white/60 text-xs leading-relaxed">
                          {feature.description}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="min-h-full flex items-center justify-center">
              <div className="w-full max-w-3xl">
                <div
                  className="rounded-2xl border border-white/[0.10] p-7"
                  style={{
                    background: 'var(--onboarding-shortcut-card-bg)',
                    boxShadow: 'var(--onboarding-shortcut-card-shadow)',
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Keyboard className="w-4 h-4 text-rose-100" />
                    <p className="text-white/90 text-sm font-medium">Current Launcher Hotkey</p>
                  </div>
                  <p className="text-white/62 text-xs mb-5">
                    Configure your launcher key below. You can add AI Prompt and Memory hotkeys later from Settings.
                  </p>

                  <div className="flex flex-wrap items-center gap-2 mb-5">
                    {hotkeyCaps.map((cap) => (
                      <span
                        key={`${cap}-${shortcut}`}
                        className="inline-flex min-w-[38px] h-9 px-3 items-center justify-center rounded-lg border border-white/[0.14] bg-white/[0.12] text-white/95 text-sm font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.20)]"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 flex-wrap mb-2">
                    <HotkeyRecorder value={shortcut} onChange={handleShortcutChange} />
                    {shortcutStatus === 'success' ? <span className="text-xs text-emerald-300">Hotkey updated</span> : null}
                    {shortcutStatus === 'error' ? <span className="text-xs text-rose-300">Shortcut unavailable</span> : null}
                  </div>

                  <p className="text-white/52 text-xs mb-4">Click the hotkey field above to update your launcher shortcut.</p>

                  <label className="flex items-center gap-2.5 mb-4 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={openAtLogin}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setOpenAtLogin(enabled);
                        void window.electron.setOpenAtLogin(enabled);
                      }}
                      className="settings-checkbox"
                    />
                    <span className="text-white/86 text-xs font-medium">Start SuperCmd at login</span>
                  </label>

                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.05] p-3.5">
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <p className="text-white/86 text-xs font-medium">Replace Spotlight (Cmd + Space)</p>
                    </div>
                    <div className="text-white/55 text-xs space-y-1">
                      <p>Manual: System Settings → Keyboard → Keyboard Shortcuts → Spotlight → disable.</p>
                      <p>Then set the launcher hotkey above to Cmd + Space.</p>
                    </div>
                  </div>
                </div>

                {requireWorkingShortcut && !hasValidShortcut ? (
                  <p className="text-xs text-amber-200/92 mt-2">
                    Your current launcher shortcut is unavailable. Set a working shortcut to continue.
                  </p>
                ) : null}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="min-h-full flex items-center justify-center">
              <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-5">
                <div
                  className="rounded-3xl border border-white/[0.09] p-5"
                  style={{
                    background: 'var(--onboarding-permission-side-bg)',
                    boxShadow: 'var(--onboarding-permission-side-shadow)',
                  }}
                >
                  <p className="text-white text-[20px] leading-tight font-semibold mb-2">Grant Access</p>
                  <p className="text-white/72 text-sm leading-relaxed mb-4">
                    We now request each permission first, then jump to the exact Privacy & Security page so SuperCmd appears where needed.
                  </p>
                  <div className="space-y-2 text-xs text-white/70">
                    <p>1. Click each access row once</p>
                    <p>2. Enable SuperCmd in System Settings</p>
                    <p>3. Return and continue setup</p>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/[0.09] bg-white/[0.05] p-4 space-y-3">
                  {permissionTargets.map((target, index) => {
                    const Icon = target.icon;
                    const isDone = Boolean(openedPermissions[target.id]);
                    const isRequested = Boolean(requestedPermissions[target.id]);
                    const note = permissionNotes[target.id];
                    const permissionNoteClass = 'mt-1 pl-[60px] text-[11px]';
                    return (
                      <div
                        key={target.id}
                        className="rounded-2xl border p-3.5"
                        style={{
                          borderColor: isDone ? 'var(--onboarding-permission-border-done)' : 'var(--onboarding-permission-border-pending)',
                          background: isDone
                            ? 'var(--onboarding-permission-done-bg)'
                            : 'var(--onboarding-permission-pending-bg)',
                          boxShadow: isDone
                            ? 'var(--onboarding-permission-done-shadow)'
                            : 'var(--onboarding-permission-pending-shadow)',
                        }}
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div className="text-white/35 text-[11px] font-semibold mt-1">{String(index + 1).padStart(2, '0')}</div>
                            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${target.iconBg}`}>
                              <Icon className={`w-4 h-4 ${target.iconTone}`} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                              <p className="text-white/96 text-sm font-semibold">
                                {target.id === 'input-monitoring'
                                      ? t('onboarding.setup.permissions.inputMonitoringTitle')
                                      : target.title}
                              </p>
                                {isDone ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-emerald-200/35 bg-emerald-500/22 text-emerald-100">
                                    <Check className="w-3 h-3" />
                                    Granted
                                  </span>
                                ) : isRequested ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] border border-amber-200/30 bg-amber-500/20 text-amber-100">
                                    Requested
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] border border-rose-200/30 bg-rose-500/20 text-rose-100">
                                    Required
                                  </span>
                                )}
                              </div>
                              <p className="text-white/68 text-xs leading-relaxed">
                                {target.id === 'input-monitoring'
                                      ? t('onboarding.setup.permissions.inputMonitoringDescription')
                                      : target.description}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => openPermissionTarget(target.id, target.url)}
                            disabled={Boolean(permissionLoading[target.id])}
                            className="inline-flex justify-center items-center gap-1.5 px-3 py-2 rounded-md border border-white/[0.12] bg-white/[0.10] hover:bg-white/[0.18] text-white text-xs font-medium transition-colors disabled:opacity-60 md:min-w-[190px]"
                          >
                            {permissionLoading[target.id] ? 'Requesting...' : 'Request Access'}
                          </button>
                        </div>
                        {!isDone && isRequested ? (
                          <p className={`${permissionNoteClass} text-amber-100/85`}>
                            Permission request sent. Enable SuperCmd in System Settings, then return.
                          </p>
                        ) : null}
                        {target.id === 'input-monitoring' ? (
                          <p className={`${permissionNoteClass} text-amber-700 dark:text-amber-100/85`}>
                            If SuperCmd is not visible here, click + and manually add SuperCmd from the Applications folder.
                          </p>
                        ) : null}
                        {target.id === 'home-folder' ? (
                          <p className={`${permissionNoteClass} text-white/52`}>
                            Pick your Home folder when prompted. This powers Search Files and launcher file results.
                          </p>
                        ) : null}
                        {!isDone && note ? (
                          <p className={`${permissionNoteClass} text-rose-100/85`}>
                            {note}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="min-h-full flex items-center justify-center">
              <div className="w-full max-w-3xl space-y-4">
                <div className="rounded-2xl border border-white/[0.10] bg-white/[0.06] p-6">
                  <p className="text-white text-xl font-semibold mb-2">{t('onboarding.setup.final.title')}</p>
                  <p className="text-white/68 text-sm leading-relaxed mb-4">
                    {t('onboarding.setup.final.description')}
                  </p>

                  <div className="flex flex-wrap gap-2 mb-4">
                    {hotkeyCaps.map((cap) => (
                      <span
                        key={`${cap}-final-${shortcut}`}
                        className="inline-flex min-w-[38px] h-9 px-3 items-center justify-center rounded-lg border border-white/[0.14] bg-white/[0.12] text-white/95 text-sm font-medium"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                  <p className="text-white/46 text-xs leading-relaxed">
                    {t('onboarding.setup.final.nextStep')}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div
          className="px-5 py-3.5 border-t border-white/[0.04] flex items-center justify-between"
          style={{
            background: 'var(--onboarding-footer-bg)',
          }}
        >
          <button
            onClick={() => {
              if (step === 0) {
                if (canCompleteOnboarding) onComplete();
                return;
              }
              setStep((prev) => Math.max(prev - 1, 0));
            }}
            disabled={step === 0 && !canCompleteOnboarding}
            className="px-3 py-1.5 rounded-md text-xs text-white/62 hover:text-white/90 hover:bg-white/[0.10] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {step === 0 ? 'Skip Setup' : 'Back'}
          </button>
          <button
            onClick={() => {
              if (step === STEPS.length - 1) {
                if (canFinish) onComplete();
                return;
              }
              if (!canContinue) return;
              setStep((prev) => Math.min(prev + 1, STEPS.length - 1));
            }}
            disabled={step === STEPS.length - 1 ? !canFinish : !canContinue}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.14] bg-gradient-to-r from-rose-500/70 to-red-500/70 hover:from-rose-500/85 hover:to-red-500/85 text-white text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {step === STEPS.length - 1 ? t('onboarding.finish') : `${t('onboarding.next')} → ${localizedSteps[step + 1]}`}
            {step === STEPS.length - 1 ? <Check className="w-3.5 h-3.5" /> : null}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingExtension;
