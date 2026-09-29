/** RN port of web/src/components/ui.jsx — same component names and props so
 *  screens translate almost line-for-line (div→View, button→Button, select→Select).
 *  All styling resolves through useTheme() tokens — never hardcode colors. */
import { Component, useEffect, useState } from 'react';
import {
  ActivityIndicator, Animated, Image, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, Text, TextInput, useAnimatedValue, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AlertTriangle, Check, ChevronDown, Info, X } from 'lucide-react-native';
import { useTheme, shadowBox, THEME_CHOICES, THEME_LABELS } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { setCurrentOrg } from '../lib/org';
import { unregisterPushToken } from '../lib/push';
import { SyncBanner } from './SyncBanner';

const WEB_BASE = process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:5173';

/* ── Typography helpers ─────────────────────────────────────────────── */
function labelStyle(t) {
  return {
    textTransform: t.labelTransform === 'uppercase' ? 'uppercase' : 'none',
    letterSpacing: t.labelTracking,
    fontWeight: t.labelWeight,
    fontSize: 13,
  };
}
export function T({ style, children, ...rest }) {
  const { t } = useTheme();
  return <Text style={[{ color: t.ink, fontSize: 14 }, style]} {...rest}>{children}</Text>;
}

/* ── Screen wrapper — SafeArea + pull-refresh scroll; mobile analog of
 *   AppShell's <main className="space-y-4 p-4">. */
export function Screen({ children, refresh, pad = 16, scroll = true }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = refresh ? async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  } : undefined;
  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: pad, paddingBottom: pad + insets.bottom + 24, gap: 14 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={refresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.ink3} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, padding: pad, gap: 14 }}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: t.surface }}>
      <SyncBanner />
      {body}
    </View>
  );
}

/* ── Button ─────────────────────────────────────────────────────────── */
export function Button({ variant = 'primary', style, children, disabled, onPress, busy, ...rest }) {
  const { t } = useTheme();
  const v = {
    primary:   { bg: t.accent, fg: t.accentFg },
    secondary: { bg: t.surface3, fg: t.ink },
    ghost:     { bg: 'transparent', fg: t.ink2 },
    danger:    { bg: t.alert, fg: '#ffffff' },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 8,
          flexDirection: 'row', paddingHorizontal: 16,
          borderRadius: t.radiusInput, borderWidth: t.elWidth, borderColor: t.elColor,
          backgroundColor: v.bg, opacity: (disabled || busy) ? 0.5 : 1,
        },
        pressed && !disabled && { transform: [{ translateX: t.pressTranslate }, { translateY: t.pressTranslate }] },
        !pressed && !disabled && variant !== 'ghost' && shadowBox(t),
        style,
      ]}
      {...rest}
    >
      {busy ? <ActivityIndicator size="small" color={v.fg} /> : null}
      {typeof children === 'string'
        ? <Text style={[labelStyle(t), { color: v.fg }]}>{children}</Text>
        : children}
    </Pressable>
  );
}

/* ── Inputs ─────────────────────────────────────────────────────────── */
export function Input({ style, ...rest }) {
  const { t } = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.ink3}
      selectionColor={t.brand}
      style={[{
        minHeight: 44, borderRadius: t.radiusInput, borderWidth: t.boxWidth, borderColor: t.boxColor,
        backgroundColor: t.surface2, paddingHorizontal: 12, paddingVertical: 8,
        fontSize: 14, color: t.ink,
      }, rest.multiline && { minHeight: 96, textAlignVertical: 'top' }, style]}
      {...rest}
    />
  );
}

/** RN has no <select> — a field that opens a Sheet of options.
 *  API: <Select value onChange options={[{value,label}]} placeholder /> */
export function Select({ value, onChange, options = [], placeholder = 'Select…', style, accessibilityLabel }) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={[{
          minHeight: 44, borderRadius: t.radiusInput, borderWidth: t.boxWidth, borderColor: t.boxColor,
          backgroundColor: t.surface2, paddingHorizontal: 12, flexDirection: 'row',
          alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }, style]}
      >
        <Text style={{ color: current ? t.ink : t.ink3, fontSize: 14, flex: 1 }} numberOfLines={1}>
          {current ? current.label : placeholder}
        </Text>
        <ChevronDown size={16} color={t.ink3} />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={accessibilityLabel ?? placeholder}>
        {current ? (
          <Text style={{ fontSize: 12, color: t.ink3 }}>
            Currently: <Text style={{ fontWeight: '700', color: t.ink2 }}>{current.label}</Text>
          </Text>
        ) : null}
        <View style={{ gap: 8 }}>
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <Pressable
                key={String(o.value)}
                onPress={() => { onChange(o.value); setOpen(false); }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[{
                  minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8,
                  paddingHorizontal: 12, paddingVertical: 10, borderRadius: t.radiusInput,
                  borderWidth: t.boxWidth, borderColor: t.boxColor,
                  backgroundColor: selected ? t.accent : t.surface2,
                }, selected ? shadowBox(t) : null]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{
                    color: selected ? t.accentFg : (o.value === '' ? t.ink3 : t.ink),
                    fontSize: 14, fontWeight: selected ? '800' : '400',
                  }}>
                    {o.label}
                  </Text>
                  {o.hint ? (
                    <Text style={{ color: selected ? t.accentFg : t.ink3, fontSize: 12 }}>{o.hint}</Text>
                  ) : null}
                </View>
                {selected ? <Check size={18} color={t.accentFg} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </>
  );
}

export function Field({ label, hint, children }) {
  const { t } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text style={[labelStyle(t), { color: t.ink2 }]}>{label}</Text>
      {children}
      {hint ? <Text style={{ fontSize: 12, color: t.ink3 }}>{hint}</Text> : null}
    </View>
  );
}

/** Checkbox row — 44px target, brutalist square box. */
export function CheckRow({ checked, onChange, label, hint }) {
  const { t } = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}
    >
      <View style={{
        width: 18, height: 18, borderWidth: Math.max(t.elWidth, 1), borderColor: t.elColor,
        borderRadius: t.chipRadius, backgroundColor: checked ? t.accent : t.surface2,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {checked ? <Text style={{ color: t.accentFg, fontSize: 12, fontWeight: '800', marginTop: -1 }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.ink2, fontSize: 14 }}>{label}</Text>
        {hint ? <Text style={{ color: t.ink3, fontSize: 12 }}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

/* ── Surfaces ───────────────────────────────────────────────────────── */
export function Card({ style, children }) {
  const { t } = useTheme();
  return (
    <View style={[{
      borderRadius: t.radiusCard, borderWidth: t.boxWidth, borderColor: t.boxColor,
      backgroundColor: t.surface2, padding: 16,
    }, style]}>
      {children}
    </View>
  );
}

export function PageHeader({ title, description, action }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 28, fontWeight: t.headingWeight, color: t.ink }}>{title}</Text>
        {description ? <Text style={{ marginTop: 2, fontSize: 14, color: t.ink3 }}>{description}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function Chip({ kind = 'neutral', label, icon }) {
  const { t } = useTheme();
  const c = t.chips[kind] ?? t.chips.neutral;
  return (
    <View style={{
      alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4,
      borderRadius: t.chipRadius, paddingHorizontal: 8, paddingVertical: 2,
      backgroundColor: c.bg, borderWidth: t.boxWidth, borderColor: c.bd,
    }}>
      {icon}
      <Text style={[labelStyle(t), { fontSize: 11, color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function Empty({ icon, title, hint, action }) {
  const { t } = useTheme();
  return (
    <View style={[
      { alignItems: 'center', gap: 8, borderRadius: t.radiusCard, padding: 16, paddingVertical: 40 },
      t.emptyBorder
        ? { borderWidth: t.dashWidth, borderColor: t.emptyBorder, borderStyle: 'dashed' }
        : null,
    ]}>
      {icon ? <View>{icon}</View> : null}
      <Text style={{ fontWeight: t.headingWeight, color: t.ink2, fontSize: 15, textAlign: 'center' }}>{title}</Text>
      {hint ? <Text style={{ maxWidth: 300, fontSize: 13, color: t.ink3, textAlign: 'center' }}>{hint}</Text> : null}
      {action}
    </View>
  );
}

export function ErrorState({ error, retry }) {
  const { t } = useTheme();
  return (
    <Empty
      icon={<AlertTriangle size={24} color={t.alert} />}
      title="Couldn't load this"
      hint={error?.message ?? 'Something went wrong — check your connection.'}
      action={retry ? <Button variant="secondary" onPress={retry}>Try again</Button> : undefined}
    />
  );
}

/** First-visit explainer. Dismissal persists in AsyncStorage by `id`. */
export function HintBanner({ id, children }) {
  const KEY = `councilog.hint.${id}`;
  const { t } = useTheme();
  const [dismissed, setDismissed] = useState(true); // hide until storage says otherwise
  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => setDismissed(v === '1')).catch(() => setDismissed(false));
  }, [KEY]);
  if (dismissed) return null;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      borderRadius: t.radiusCard, borderWidth: t.boxWidth, borderColor: t.boxColor,
      backgroundColor: t.surface3, paddingHorizontal: 12, paddingVertical: 8,
    }}>
      <Info size={15} color={t.brand} style={{ marginTop: 2 }} />
      <Text style={{ flex: 1, fontSize: 13, color: t.ink2 }}>{children}</Text>
      <Pressable
        accessibilityLabel="Dismiss hint" accessibilityRole="button" hitSlop={8}
        style={{ minHeight: 28, minWidth: 28, alignItems: 'center', justifyContent: 'center' }}
        onPress={() => { AsyncStorage.setItem(KEY, '1').catch(() => {}); setDismissed(true); }}
      >
        <X size={14} color={t.ink3} />
      </Pressable>
    </View>
  );
}

export function Skeleton({ style }) {
  const { t } = useTheme();
  const opacity = useAnimatedValue(0.5);
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ borderRadius: t.radiusInput, backgroundColor: t.surface3, opacity, height: 16 }, style]} />;
}

/* ── Sheet — bottom-anchored modal with pinned header + scrollable body. */
export function Sheet({ open, onClose, children, title }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
            onPress={onClose}
            accessibilityLabel="Close"
            accessibilityRole="button"
          />
          <View style={{
            maxHeight: '85%', borderTopLeftRadius: t.radiusSheet, borderTopRightRadius: t.radiusSheet,
            borderWidth: t.boxWidth, borderColor: t.boxColor, backgroundColor: t.surface2,
            ...shadowBox(t, 'shadow2'),
          }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12,
            }}>
              <Text style={{ fontSize: 18, fontWeight: t.headingWeight, color: t.ink, flex: 1 }}>{title}</Text>
              <Pressable
                onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" hitSlop={8}
                style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={18} color={t.ink3} />
              </Pressable>
            </View>
            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(20, insets.bottom + 12), gap: 12 }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Confirmation for destructive/irreversible actions. `requireText` adds a
 *  type-to-confirm gate: the confirm button stays disabled until the input
 *  matches exactly (used for account/org deletion). */
export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', danger = true, busy, requireText }) {
  const [typed, setTyped] = useState('');
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setTyped('');
  }
  const confirmed = !requireText || typed === requireText;
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <Body>{body}</Body>
      {requireText && open ? (
        <Field label={`Type ${requireText} to confirm`}>
          <Input autoFocus value={typed} onChangeText={setTyped} autoComplete="off" autoCapitalize="none" />
        </Field>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="secondary" onPress={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onPress={onConfirm} disabled={busy || !confirmed} busy={busy}>
          {confirmLabel}
        </Button>
      </View>
    </Sheet>
  );
}
function Body({ children }) {
  const { t } = useTheme();
  return <Text style={{ fontSize: 14, color: t.ink2 }}>{children}</Text>;
}

export function Avatar({ name, url, size = 28 }) {
  const { t } = useTheme();
  const initials = (name ?? '?').split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  const box = {
    width: size, height: size, borderRadius: t.avatarRadius,
    borderWidth: Math.max(t.elWidth, 1), borderColor: t.elColor, overflow: 'hidden',
  };
  if (url) return <Image source={{ uri: url }} accessibilityLabel={name ?? ''} style={box} />;
  return (
    <View style={[box, { backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ fontSize: size * 0.4, fontWeight: '700', color: t.accentFg }}>{initials}</Text>
    </View>
  );
}

/** Theme picker — system + 4 variants via a Sheet. */
export function ThemePicker({ style }) {
  const { choice, setChoice } = useTheme();
  return (
    <Select
      value={choice}
      onChange={setChoice}
      options={THEME_CHOICES.map((c) => ({ value: c, label: THEME_LABELS[c] }))}
      accessibilityLabel="Theme"
      style={style}
    />
  );
}

/** App-shell error boundary: friendly card + reload + sign-out escape. */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('app error:', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorBoundaryInner reset={() => this.setState({ error: null })} />;
  }
}
function ErrorBoundaryInner({ reset }) {
  const { t } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 380, gap: 12, alignItems: 'center' }}>
        <AlertTriangle size={28} color={t.alert} />
        <Text style={{ fontSize: 18, fontWeight: t.headingWeight, color: t.ink }}>Something broke</Text>
        <Text style={{ fontSize: 14, color: t.ink3, textAlign: 'center' }}>
          The app hit an unexpected error. Reloading usually fixes it.
        </Text>
        <Button style={{ alignSelf: 'stretch' }} onPress={reset}>Try again</Button>
        <Pressable
          accessibilityRole="button"
          style={{ minHeight: 44, justifyContent: 'center' }}
          onPress={async () => { await unregisterPushToken(); await supabase.auth.signOut(); setCurrentOrg(null); reset(); }}
        >
          <Text style={{ fontSize: 14, color: t.ink3 }}>Sign out instead</Text>
        </Pressable>
      </Card>
    </View>
  );
}

export { WEB_BASE };
