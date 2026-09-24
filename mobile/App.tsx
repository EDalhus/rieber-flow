import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';

// Sett EXPO_PUBLIC_API_URL i mobile/.env (se .env.example)
const API = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/$/, '') + '/api';

type Salt = { id: number; salttype: string; fargekode: string; tonn_bulk: number };
type Steg = { steg_id: number; rekkefolge_nummer: number; kunde: string; salttype: string; tonn: number; fargekode: string };
type SO = { id: number; ordrenummer: string; kunde: string; salttype: string; tonn: number; fargekode: string };
type Sjafor =
  | { modus: 'bat'; batanlop: { skipsnavn: string; tonn_totalt: number; tonn_lastet: number }; aktiv: Steg | null; neste: Steg | null; varer: Salt[] }
  | { modus: 'lastebil'; ko: SO[]; varer: Salt[] };

const post = (path: string) => fetch(API + path, { method: 'POST' });

const textOn = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150 ? '#111' : '#fff';
};

/** Hold inne for å bekrefte – hindrer utilsiktede trykk i en rystende maskin. */
function HoldKnapp({ tekst, onDone }: { tekst: string; onDone: () => void }) {
  const fill = useRef(new Animated.Value(0)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  return (
    <Pressable
      style={s.hold}
      onPressIn={() => {
        Haptics.selectionAsync();
        anim.current = Animated.timing(fill, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: false });
        anim.current.start(({ finished }) => {
          if (finished) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onDone();
          }
          fill.setValue(0);
        });
      }}
      onPressOut={() => { anim.current?.stop(); fill.setValue(0); }}
    >
      <Animated.View style={[s.holdFill, { width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
      <Text style={s.holdTekst}>{tekst}</Text>
    </Pressable>
  );
}

/** Kortet "popper opp" hver gang oppgaven byttes ut (auto-skjuling av forrige). */
function PopIn({ id, children, style }: { id: string | number; children: React.ReactNode; style: any }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    Animated.spring(v, { toValue: 1, useNativeDriver: true, friction: 6 }).start();
  }, [id, v]);
  return <Animated.View style={[style, { opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]}>{children}</Animated.View>;
}

export default function App() {
  useKeepAwake();
  const [data, setData] = useState<Sjafor | null>(null);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await (await fetch(API + '/sjafor')).json());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  const ferdig = async (path: string) => {
    await post(path).catch(() => {});
    load();
  };

  let innhold: React.ReactNode = <Text style={s.senter}>Laster…</Text>;
  let bunn: React.ReactNode = null;

  if (data?.modus === 'bat') {
    const { batanlop: b, aktiv, neste } = data;
    if (!aktiv) {
      innhold = <Text style={s.senter}>✅{'\n'}BÅT FERDIG{'\n'}<Text style={{ fontSize: 28 }}>{b.skipsnavn}</Text></Text>;
    } else {
      innhold = (
        <>
          <Text style={s.topp}>🚢 {b.skipsnavn}</Text>
          <PopIn id={aktiv.steg_id} style={[s.kort, { backgroundColor: aktiv.fargekode }]}>
            <Text style={[s.steg, { color: textOn(aktiv.fargekode) }]}>STEG {aktiv.rekkefolge_nummer}</Text>
            <Text style={[s.tonn, { color: textOn(aktiv.fargekode) }]} adjustsFontSizeToFit numberOfLines={1}>{Math.round(aktiv.tonn)}t</Text>
            <Text style={[s.salt, { color: textOn(aktiv.fargekode) }]} adjustsFontSizeToFit numberOfLines={1}>{aktiv.salttype.toUpperCase()}</Text>
            <Text style={[s.kunde, { color: textOn(aktiv.fargekode) }]} numberOfLines={2}>{aktiv.kunde}</Text>
          </PopIn>
          <HoldKnapp tekst="HOLD INNE: FERDIG" onDone={() => ferdig(`/lasteplan/${aktiv.steg_id}/ferdig`)} />
          {neste && (
            <View style={[s.neste, { borderLeftColor: neste.fargekode }]}>
              <Text style={s.nesteTekst}>NESTE: {Math.round(neste.tonn)}t {neste.salttype}</Text>
            </View>
          )}
        </>
      );
    }
    const pct = Math.min(100, (b.tonn_lastet / Math.max(1, b.tonn_totalt)) * 100);
    bunn = (
      <View style={s.prog}>
        <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` }]} /></View>
        <Text style={s.progTekst}>{Math.round(b.tonn_lastet)} / {Math.round(b.tonn_totalt)} tonn lastet</Text>
      </View>
    );
  } else if (data?.modus === 'lastebil') {
    innhold = (
      <>
        <Text style={s.topp}>🚚 Lastebil-kø</Text>
        {data.ko.length === 0 && <Text style={s.senter}>Ingen ordrer</Text>}
        {data.ko.map((o, i) => (
          <PopIn key={o.id} id={o.id} style={[s.kort, i > 0 && s.kortLite, { backgroundColor: o.fargekode }]}>
            <Text style={[i ? s.tonnLite : s.tonn, { color: textOn(o.fargekode) }]} adjustsFontSizeToFit numberOfLines={1}>{Math.round(o.tonn)}t {o.salttype.toUpperCase()}</Text>
            <Text style={[s.kunde, { color: textOn(o.fargekode) }]} numberOfLines={1}>{o.kunde}</Text>
          </PopIn>
        ))}
        {data.ko[0] && <HoldKnapp tekst="HOLD: FERDIG" onDone={() => ferdig(`/salgsordrer/${data.ko[0].id}/ferdig`)} />}
      </>
    );
  }

  return (
    <View style={s.rot}>
      <StatusBar style="light" />
      {offline && <Text style={s.offline}>Ingen forbindelse – prøver igjen…</Text>}
      {innhold}
      {bunn}
    </View>
  );
}

const s = StyleSheet.create({
  rot: { flex: 1, backgroundColor: '#000', paddingTop: 54, paddingHorizontal: 14, paddingBottom: 28, gap: 12 },
  topp: { color: '#9aa4b8', fontSize: 24, fontWeight: '800' },
  senter: { color: '#fff', fontSize: 52, fontWeight: '900', textAlign: 'center', flex: 1, textAlignVertical: 'center' },
  offline: { backgroundColor: '#b42318', color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', padding: 8, borderRadius: 8 },
  kort: { flex: 1, borderRadius: 26, padding: 20, justifyContent: 'center' },
  kortLite: { flex: 0, paddingVertical: 14 },
  steg: { fontSize: 30, fontWeight: '800', opacity: 0.85 },
  tonn: { fontSize: 130, fontWeight: '900', lineHeight: 140 },
  tonnLite: { fontSize: 44, fontWeight: '900' },
  salt: { fontSize: 56, fontWeight: '900' },
  kunde: { fontSize: 28, fontWeight: '700', opacity: 0.9, marginTop: 4 },
  hold: { height: 96, borderRadius: 20, backgroundColor: '#2a2f3a', justifyContent: 'center', overflow: 'hidden' },
  holdFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#22c55e' },
  holdTekst: { color: '#fff', fontSize: 28, fontWeight: '900', textAlign: 'center' },
  neste: { borderLeftWidth: 14, backgroundColor: '#161b26', padding: 12, borderRadius: 10 },
  nesteTekst: { color: '#fff', fontSize: 22, fontWeight: '800' },
  prog: { backgroundColor: '#161b26', borderRadius: 16, padding: 14 },
  bar: { height: 26, borderRadius: 13, backgroundColor: '#2a2f3a', overflow: 'hidden', marginBottom: 8 },
  barFill: { height: '100%', backgroundColor: '#22c55e' },
  progTekst: { color: '#fff', fontSize: 26, fontWeight: '900', textAlign: 'center' },
});
