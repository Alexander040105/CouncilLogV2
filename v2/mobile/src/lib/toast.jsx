/** RN port of web/src/lib/toast.jsx — same push/auto-dismiss contract,
 *  rendered as a floating banner stack above the tab bar. */
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CheckCircle2, XCircle, X } from 'lucide-react-native';
import { useTheme, shadowBox } from './theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ToastCtx = createContext(null);

let seq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});
  const { t } = useTheme();
  const insets = useSafeAreaInsets();

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    setToasts((ts) => ts.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((kind, msg) => {
    const id = ++seq;
    setToasts((ts) => [...ts.slice(-3), { id, kind, msg }]);
    timers.current[id] = setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  const toast = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
  };

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 16, right: 16, bottom: 84 + insets.bottom, gap: 8, zIndex: 60 }}
        accessibilityLiveRegion="polite"
      >
        {toasts.map((x) => (
          <View
            key={x.id}
            style={{
              flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden',
              borderRadius: t.radiusCard, borderWidth: t.boxWidth, borderColor: t.boxColor,
              backgroundColor: t.surface3, ...shadowBox(t),
            }}
          >
            <View style={{ width: 6, backgroundColor: x.kind === 'success' ? t.done : t.alert }} />
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
              {x.kind === 'success'
                ? <CheckCircle2 size={16} color={t.done} />
                : <XCircle size={16} color={t.alert} />}
              <Text style={{ flex: 1, color: t.ink, fontSize: 14 }}>{x.msg}</Text>
              <Pressable
                onPress={() => dismiss(x.id)}
                accessibilityLabel="Dismiss"
                accessibilityRole="button"
                hitSlop={8}
                style={{ minHeight: 28, minWidth: 28, alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={14} color={t.ink3} />
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
