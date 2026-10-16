import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet,
  Switch, Text, useWindowDimensions, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as Speech from 'expo-speech';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { getStatus, putConfig, testBox } from './src/deviceClient';
import { toWireConfig } from './src/protocol';
import {
  AppData, Configuration, decideDispense, DoseRecord, id, localDay, localTime, Medicine,
  minutes, Profile, Schedule, syncDevice, updateConfiguration, validateConfiguration, WINDOW_MINUTES,
} from './src/domain';
import { useAppData } from './src/useAppData';
import { Badge, Button, Card, Choice, colors, Dialog, Empty, Field, Icon, IconName, Label, Muted, s } from './src/ui';

type Page = 'overview' | 'schedules' | 'people' | 'medicines' | 'device' | 'history';
type Form =
  | { kind: 'profile'; item?: Profile }
  | { kind: 'medicine'; item?: Medicine }
  | { kind: 'schedule'; item?: Schedule };
const navigation: { id: Page; label: string; icon: IconName }[] = [
  { id: 'overview', label: '대시보드', icon: 'grid' },
  { id: 'schedules', label: '복약 일정', icon: 'calendar' },
  { id: 'people', label: '대상자 관리', icon: 'users' },
  { id: 'medicines', label: '약 · 약통 관리', icon: 'package' },
  { id: 'device', label: '기기 연결', icon: 'cpu' },
  { id: 'history', label: '활동 기록', icon: 'clock' },
];
const pageTitles: Record<Page, [string, string]> = {
  overview: ['오늘도 안심할 수 있도록', '소중한 가족의 복약 일정을 한눈에 살펴보세요.'],
  schedules: ['하루의 건강한 약속', '처방 내용을 보호자가 확인한 뒤 일정을 등록해 주세요.'],
  people: ['함께 돌보는 우리 가족', '대상자의 이름, 칭호와 참고 사진을 관리해요.'],
  medicines: ['작은 약통, 세심한 관리', '대상자별 약을 1~4번 약통에 연결해요.'],
  device: ['안심을 연결하는 공간', '모의 안전 검증과 빈 약통용 실제 UART 통신을 시험해요.'],
  history: ['차곡차곡 쌓이는 돌봄 기록', '모의 배출과 차단 기록입니다. 실제 복용을 의미하지 않아요.'],
};
const statusLabels: Record<DoseRecord['status'], string> = {
  dispensing: '배출 진행', dispensed: '모의 배출', blocked: '안전 차단', interrupted: '확인 필요',
};
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const idleGuide = '카메라 인식 대신 테스트 조건을 선택해 주세요.';

function Avatar({ profile, large = false }: { profile?: Profile; large?: boolean }) {
  return <View style={[styles.avatar, large && styles.avatarLarge]}>
    {profile?.faceUri
      ? <Image source={{ uri: profile.faceUri }} style={{ width: '100%', height: '100%' }} accessibilityLabel={`${profile.name} 참고 사진`} />
      : <Icon name="user" size={large ? 32 : 22} color={colors.teal} />}
  </View>;
}

function Tray({ medicines, activeBox, phase }: { medicines: Medicine[]; activeBox?: number; phase?: string }) {
  return <View style={styles.tray}>
    <View style={s.between}><View style={s.row}><View style={styles.deviceDot} /><Text style={styles.deviceBrand}>MEDICARE TRAY</Text></View><Icon name="radio" size={16} color={colors.muted} /></View>
    <View style={styles.trayBoxes}>{[1, 2, 3, 4].map(box => {
      const medicine = medicines.find(m => m.box === box);
      const active = activeBox === box;
      return <View key={box} style={[styles.trayBox, active && styles.trayBoxActive]}>
        <Text style={[styles.boxNumber, active && { color: colors.teal }]}>{String(box).padStart(2, '0')}</Text>
        <View style={[styles.pill, !medicine && { opacity: 0.18 }, active && { backgroundColor: '#A8DCC7' }]}>
          <View style={styles.pillHalf} />
        </View>
        <Text numberOfLines={1} style={styles.boxCaption}>{active ? phase : medicine ? '등록됨' : '비어 있음'}</Text>
      </View>;
    })}</View>
    <View style={s.between}><Text style={styles.trayFoot}>4-COMPARTMENT SMART CARE</Text><Text style={styles.trayFoot}>SIMULATOR</Text></View>
  </View>;
}

export default function App() {
  return <SafeAreaProvider><Application /></SafeAreaProvider>;
}

function Application() {
  const { data, loadError, load, mutate, saving } = useAppData();
  const { width } = useWindowDimensions();
  const desktop = width >= 1040;
  const wide = width >= 1280;
  const [page, setPage] = useState<Page>('overview');
  const [patient, setPatient] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState('youngsun');
  const [form, setForm] = useState<Form | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [confirmation, setConfirmation] = useState<{ title: string; text: string; action: () => Promise<void> } | null>(null);
  const [now, setNow] = useState(new Date());
  const [online, setOnline] = useState(true);
  const [simProfile, setSimProfile] = useState('youngsun');
  const [simSchedule, setSimSchedule] = useState('morning');
  const [simTime, setSimTime] = useState('08:00');
  const [matches, setMatches] = useState(true);
  const [running, setRunning] = useState(false);
  const runLock = useRef(false);
  const [activeBox, setActiveBox] = useState<number>();
  const [phase, setPhase] = useState('잠금');
  const [guide, setGuide] = useState(idleGuide);
  const [voice, setVoice] = useState(true);
  const [deviceUrl, setDeviceUrl] = useState('http://192.168.0.20');
  const [deviceToken, setDeviceToken] = useState('');
  const [realBusy, setRealBusy] = useState(false);
  const [realStatus, setRealStatus] = useState('아직 연결을 확인하지 않았습니다.');
  const realCall = async (task: () => Promise<string>) => {
    if (realBusy) return;
    setRealBusy(true);
    try { setRealStatus(await task()); } catch (error) { setRealStatus(error instanceof Error ? error.message : '기기 통신 실패'); }
    finally { setRealBusy(false); }
  };
  const busy = running || saving;
  const flash = (text: string, error = false) => setNotice({ text, error });
  const report = (error: unknown) => flash(error instanceof Error ? error.message : '작업을 완료하지 못했습니다. 다시 확인해 주세요.', true);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => { clearInterval(timer); void Speech.stop(); };
  }, []);
  useEffect(() => {
    const profiles = patient ? data?.device?.profiles : data?.profiles;
    if (profiles && !profiles.some(p => p.id === selectedProfile)) setSelectedProfile(profiles[0]?.id ?? '');
  }, [data, selectedProfile, patient]);

  const speak = (text: string, manual = false) => {
    if (!voice && !manual) return;
    void Speech.stop().then(() => {
      Speech.speak(text, {
        language: 'ko-KR', rate: 0.85,
        onError: () => flash('음성을 재생하지 못했습니다. 화면 안내를 확인해 주세요.', true),
      });
    }).catch(report);
  };
  const configure = async (update: Partial<Configuration>) => {
    await mutate(previous => updateConfiguration(previous, update));
  };
  const sync = async () => {
    if (!online) { flash('연결을 켠 후 동기화해 주세요. 오프라인에서는 마지막 설정으로만 동작합니다.', true); return; }
    try {
      await mutate(previous => syncDevice(previous));
      flash('모의 기기에 설정을 저장했어요. 실제 장치로 전송된 것은 아닙니다.');
    } catch (error) { report(error); }
  };
  const simulate = async (profileId: string, scheduleId: string, clockTime: string, medicineMatches: boolean) => {
    if (runLock.current) return;
    runLock.current = true;
    setRunning(true);
    let reservedId: string | undefined;
    try {
      let record: DoseRecord | undefined;
      let allowed = false;
      await mutate(previous => {
        const decision = decideDispense(previous, { profileId, scheduleId, clockTime, medicineMatches, now: new Date() });
        record = decision.record;
        allowed = decision.allowed;
        return { ...previous, records: [decision.record, ...previous.records] };
      });
      if (!record) throw new Error('테스트 이력을 저장하지 못했습니다.');
      setGuide(record.message);
      speak(record.message);
      if (!allowed) { flash(record.message, true); return; }
      reservedId = record.id;
      for (const box of record.boxes) {
        setActiveBox(box);
        setPhase('열림');
        setGuide(`${box}번 약통을 열었어요. 다음 칸은 현재 칸을 닫은 뒤 열립니다.`);
        await wait(1400);
        setPhase('닫힘');
        await wait(850);
        setActiveBox(undefined);
        await wait(250);
      }
      await mutate(previous => ({
        ...previous,
        records: previous.records.map(r => r.id === reservedId
          ? { ...r, status: 'dispensed', message: '모든 약통의 모의 순차 개폐가 끝났습니다. 실제 복용 여부는 확인되지 않았습니다.' }
          : r),
      }));
      setGuide('모의 개폐가 끝났어요. 실제 약 배출이나 복용 확인은 이루어지지 않았습니다.');
      speak('모의 개폐가 끝났습니다. 실제 약을 드셨다는 의미는 아닙니다.');
      flash('순차 개폐 테스트 완료 · 실제 복용은 미확인');
    } catch (error) {
      setGuide('오류로 테스트를 멈췄습니다. 보호자가 기록을 확인해 주세요.');
      report(error);
      if (reservedId) {
        try {
          await mutate(previous => ({
            ...previous,
            records: previous.records.map(r => r.id === reservedId
              ? { ...r, status: 'interrupted', message: '테스트 중 오류 발생. 중복 배출 방지를 위해 다시 열지 않습니다.' } : r),
          }));
        } catch (saveError) { report(saveError); }
      }
    } finally {
      setActiveBox(undefined);
      setPhase('잠금');
      runLock.current = false;
      setRunning(false);
    }
  };

  if (!data) return <SafeAreaView style={styles.loading}>
    <Icon name="heart" size={36} color={colors.teal} /><Text style={styles.heading}>Medicare Tray</Text>
    {loadError ? <><Text style={{ color: colors.danger, textAlign: 'center' }}>{loadError}</Text>
      <Muted>기존 데이터는 덮어쓰지 않았습니다. 저장 공간과 브라우저 설정을 확인해 주세요.</Muted>
      <Button label="다시 불러오기" onPress={() => { void load(); }} icon="refresh-cw" /></> : <ActivityIndicator color={colors.teal} />}
  </SafeAreaView>;

  const profile = data.profiles.find(p => p.id === selectedProfile);
  const day = localDay(now);
  const todayRecords = data.records.filter(r => r.day === day);
  const schedules = data.schedules.filter(item => item.profileId === selectedProfile).sort((a, b) => a.time.localeCompare(b.time));
  const allSchedules = [...data.schedules].sort((a, b) => a.time.localeCompare(b.time));
  const totalEnabled = data.schedules.filter(item => item.enabled).length;
  const completed = new Set(todayRecords.filter(r => r.status === 'dispensed' && data.schedules.some(sc => sc.id === r.scheduleId && sc.enabled)).map(r => r.scheduleId)).size;
  const progress = totalEnabled ? Math.round(completed / totalEnabled * 100) : 0;
  const device = data.device;
  const patientProfile = device?.profiles.find(p => p.id === selectedProfile);
  const synchronized = device?.revision === data.revision;
  const currentMinutes = minutes(localTime(now));
  const nextSchedule = schedules.find(item => item.enabled && minutes(item.time) >= currentMinutes &&
    !todayRecords.some(r => r.scheduleId === item.id && r.status !== 'blocked'));
  const patientSchedules = device?.schedules.filter(sc => sc.profileId === selectedProfile && sc.enabled)
    .sort((a, b) => a.time.localeCompare(b.time)) ?? [];
  const availablePatientSchedule = patientSchedules.find(sc => currentMinutes >= minutes(sc.time) &&
    currentMinutes < minutes(sc.time) + WINDOW_MINUTES &&
    !todayRecords.some(r => r.scheduleId === sc.id && r.status !== 'blocked'));

  const deleteProfile = (item: Profile) => setConfirmation({
    title: `${item.name}님을 삭제할까요?`,
    text: '연결된 앱의 약과 일정도 삭제됩니다. 활동 기록과 마지막 모의 기기 설정은 유지되며, 기기 설정은 다시 동기화해야 변경됩니다.',
    action: async () => {
      await configure({
        profiles: data.profiles.filter(p => p.id !== item.id),
        medicines: data.medicines.filter(m => m.profileId !== item.id),
        schedules: data.schedules.filter(sc => sc.profileId !== item.id),
      });
    },
  });
  const deleteMedicine = (item: Medicine) => {
    if (data.schedules.some(sc => sc.medicineIds.includes(item.id))) {
      flash('일정에 연결된 약입니다. 해당 일정을 먼저 수정하거나 삭제해 주세요.', true);
      return;
    }
    setConfirmation({ title: '약 등록을 삭제할까요?', text: `${item.name}의 앱 등록을 삭제합니다. 기기에는 재동기화 후 반영됩니다.`,
      action: async () => { await configure({ medicines: data.medicines.filter(m => m.id !== item.id) }); } });
  };
  const renderSchedule = (schedule: Schedule) => {
    const owner = data.profiles.find(p => p.id === schedule.profileId);
    const record = todayRecords.find(r => r.scheduleId === schedule.id && r.status !== 'blocked');
    return <View key={schedule.id} style={styles.scheduleRow}>
      <View style={[styles.timeIcon, { backgroundColor: schedule.label === '저녁' ? '#F0EDF7' : '#FFF3DE' }]}>
        <Icon name={schedule.label === '저녁' ? 'moon' : schedule.label === '점심' ? 'sun' : 'sunrise'} color={schedule.label === '저녁' ? '#8273A3' : '#B78B3E'} size={23} />
      </View>
      <View style={{ minWidth: 88 }}><Text style={styles.time}>{schedule.time}</Text><Muted>{schedule.label} 약</Muted></View>
      <View style={{ flex: 1, minWidth: 130, gap: 5 }}>
        <Label>{owner?.name} {owner?.title}</Label>
        <Muted>{schedule.medicineIds.map(mid => {
          const med = data.medicines.find(m => m.id === mid);
          return med ? `${med.box}번 · ${med.name}` : '연결 오류';
        }).join(' / ')}</Muted>
      </View>
      <Badge label={!schedule.enabled ? '일시 중지' : record ? statusLabels[record.status] : '예정'}
        tone={!schedule.enabled ? 'gray' : record?.status === 'interrupted' ? 'red' : record ? 'mint' : 'gray'} />
      {page === 'schedules' && <View style={s.row}>
        <Switch accessibilityLabel={`${owner?.name} ${schedule.label} 일정 활성화`} value={schedule.enabled} disabled={busy}
          trackColor={{ false: '#CAD7D1', true: '#087F72' }}
          onValueChange={enabled => { void configure({ schedules: data.schedules.map(sc => sc.id === schedule.id ? { ...sc, enabled } : sc) }).catch(report); }} />
        <Button label="수정" small secondary disabled={busy} onPress={() => setForm({ kind: 'schedule', item: schedule })} />
        <Button label="삭제" small danger disabled={busy} onPress={() => setConfirmation({
          title: '일정을 삭제할까요?', text: `${owner?.name}님의 ${schedule.time} ${schedule.label} 일정이 삭제됩니다. 기록은 유지되며 기기에는 재동기화 후 반영됩니다.`,
          action: async () => { await configure({ schedules: data.schedules.filter(sc => sc.id !== schedule.id) }); },
        })} />
      </View>}
    </View>;
  };
  const renderRecord = (record: DoseRecord) => <View key={record.id} style={styles.recordRow}>
    <View style={[styles.recordIcon, { backgroundColor: record.status === 'blocked' || record.status === 'interrupted' ? '#FFF2DD' : colors.mint }]}>
      <Icon name={record.status === 'blocked' || record.status === 'interrupted' ? 'shield' : 'check'} size={16}
        color={record.status === 'blocked' || record.status === 'interrupted' ? colors.amber : colors.teal} />
    </View>
    <View style={{ flex: 1, gap: 4 }}><Label>{record.profileName} · {record.scheduleLabel}</Label>
      <Muted>{record.message}</Muted><Text style={styles.recordDate}>{new Date(record.at).toLocaleString('ko-KR')}{record.boxes.length > 0 ? ` · 약통 ${record.boxes.join(', ')}` : ''}</Text></View>
    <Badge label={statusLabels[record.status]} tone={record.status === 'blocked' ? 'amber' : record.status === 'interrupted' ? 'red' : 'mint'} />
  </View>;

  const profileSelector = <View style={s.wrap}>{data.profiles.map(p =>
    <Choice key={p.id} label={`${p.name} ${p.title}`} selected={selectedProfile === p.id} onPress={() => setSelectedProfile(p.id)} />)}</View>;
  const toast = notice && <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.notice, notice.error && styles.noticeError]}>
    <Icon name={notice.error ? 'alert-circle' : 'check-circle'} size={18} color={notice.error ? colors.danger : colors.teal} />
    <Text style={[styles.noticeText, notice.error && { color: colors.danger }]}>{notice.text}</Text>
    <Button label="확인" small secondary onPress={() => setNotice(null)} />
  </View>;

  const devicePanel = <View style={{ gap: 22 }}>
    <Card>
        <View style={s.between}><View style={s.row}><View style={styles.sectionIcon}><Icon name="wifi" color={colors.teal} /></View>
          <View><Text style={styles.cardTitle}>실제 AiCoco Cam 연결</Text><Muted>같은 Wi-Fi의 기기 HTTP API (firmware/cam)</Muted></View></View>
          <Badge label="하드웨어 미검증" tone="amber" /></View>
        <Field label="기기 주소" value={deviceUrl} onChangeText={setDeviceUrl} placeholder="http://192.168.0.20" />
        <Field label="기기 토큰 (로컬 펌웨어 설정)" value={deviceToken} onChangeText={setDeviceToken} secureTextEntry />
        <Muted>빈 약통 전용 시험입니다. 브라우저에서는 캠 IP 주소를 직접 열어 내장 시험 페이지를 사용하세요. 앱 웹 미리보기의 교차 출처 요청은 차단됩니다.</Muted>
        <View style={s.wrap}>
          <Button label="연결 확인" small secondary icon="activity" disabled={realBusy} onPress={() => {
            void realCall(async () => { const st = await getStatus(deviceUrl);
              return `연결됨 · UART ${st.uartReady ? '설정됨' : '미설정'} · UNO ${st.uno ? '완료 응답 수신 이력 있음' : '완료 응답 미확인'} · 현장 점검 ${st.inspectionRequired ? '필요' : '잠금 없음'} · 얼굴모델 ${st.faceModel ? '있음' : '없음'} · 약모델 ${st.pillModel ? '있음' : '없음'}`; });
          }} />
          <Button label="설정 전송" small icon="upload" disabled={realBusy || !data} onPress={() => {
            void realCall(async () => {
              if (!data) throw new Error('데이터를 불러오는 중입니다.');
              validateConfiguration(data);
              await putConfig(deviceUrl, toWireConfig(data, data.revision), deviceToken);
              return `설정 v${data.revision} 저장 응답을 받았습니다. 모의 기기 설정과는 별개입니다.`;
            });
          }} />
        </View>
        <Label>약통 열기 시험 (보호자 확인용 · 1칸씩)</Label>
        <View style={s.wrap}>{[1, 2, 3, 4].map(box => <Button key={box} label={`${box}번 열기`} small secondary disabled={realBusy}
          onPress={() => { void realCall(async () => { await testBox(deviceUrl, box, deviceToken); return `${box}번 UNO 완료 응답 수신 (물리적 닫힘·복용 여부 미확인)`; }); }} />)}</View>
        <View style={styles.guide}><Icon name="info" color={colors.teal} /><Text accessibilityLiveRegion="polite" style={styles.guideText}>{realStatus}</Text></View>
        <Muted>문자 1~4 / K·OK 브리지 펌웨어는 자동 일정·설정 저장·카메라 AI를 제공하지 않습니다. 아래 시나리오는 계속 모의입니다.</Muted>
      </Card>
      <Card>
      <View style={s.between}><View style={s.row}><View style={styles.sectionIcon}><Icon name="cpu" color={colors.teal} /></View>
        <View><Text style={styles.cardTitle}>Medicare Tray · 가상 기기</Text><Muted>스마트 약통 / 시뮬레이션 전용</Muted></View></View>
        <Badge label={online ? '모의 연결됨' : '모의 오프라인'} tone={online ? 'mint' : 'gray'} /></View>
      <Tray medicines={device?.medicines ?? []} activeBox={activeBox} phase={phase} />
      <View style={s.between}><View style={{ flex: 1, minWidth: 180, gap: 4 }}>
        <Label>앱 ↔ 기기 모의 연결</Label><Muted>연결을 꺼도 마지막 동기화된 설정으로 테스트할 수 있어요.</Muted></View>
        <Switch accessibilityLabel="앱과 모의 기기 연결" value={online} onValueChange={setOnline} disabled={busy}
          trackColor={{ false: '#CAD7D1', true: '#087F72' }} /></View>
      <View style={styles.syncInfo}><Icon name={synchronized ? 'check-circle' : 'refresh-cw'} size={16} color={colors.teal} />
        <Text style={styles.syncText}>{device ? `마지막 모의 저장: ${new Date(device.syncedAt).toLocaleString('ko-KR')} · 설정 v${device.revision}` : '기기에 저장된 설정이 없습니다.'}</Text></View>
      {!synchronized && <Text style={styles.warningText}>앱 설정 v{data.revision}을 동기화해 주세요. 테스트는 기기에 저장된 이전 설정을 사용합니다.</Text>}
      <Button label="설정 동기화 (모의)" icon="refresh-cw" disabled={busy || !online} onPress={() => { void sync(); }} />
    </Card>
    <Card>
      <View style={s.between}><Text style={styles.cardTitle}>안전 시나리오 테스트</Text><Badge label="실제 인식 아님" tone="amber" /></View>
      <Muted>사진을 분석하지 않습니다. 아래 값은 얼굴·약물 인식과 RTC의 모의 입력입니다. 테스트 이력은 앱에 저장됩니다.</Muted>
      <Label>1. 카메라 앞에 선 사람 (모의)</Label>
      <View style={s.wrap}>{(device?.profiles ?? []).map(p => <Choice key={p.id} label={`${p.name} ${p.title}`}
        selected={simProfile === p.id} onPress={() => setSimProfile(p.id)} disabled={busy} />)}
        <Choice label="미등록 사용자" selected={simProfile === 'unknown'} onPress={() => setSimProfile('unknown')} disabled={busy} /></View>
      <Label>2. 확인할 복약 일정</Label>
      <View style={s.wrap}>{(device?.schedules ?? []).map(sc => <Choice key={sc.id}
        label={`${device?.profiles.find(p => p.id === sc.profileId)?.name} · ${sc.label} ${sc.time}${sc.enabled ? '' : ' (중지)'}`}
        selected={simSchedule === sc.id} onPress={() => { setSimSchedule(sc.id); setSimTime(sc.time); }} disabled={busy} />)}</View>
      {!device && <Muted>위의 동기화 버튼으로 먼저 가상 기기에 일정을 저장해 주세요.</Muted>}
      <Field label="3. 기기 시각 (HH:MM · 오늘 날짜)" value={simTime} onChangeText={setSimTime} placeholder="08:00" maxLength={5} />
      <Muted>데모 허용 시간: 예약 시각부터 {WINDOW_MINUTES}분 미만. 날짜는 현재 기기의 로컬 날짜입니다.</Muted>
      <View style={s.between}><View><Label>4. 약물 이미지 일치 (모의)</Label><Muted>끄면 오복용 차단을 테스트합니다.</Muted></View>
        <Switch accessibilityLabel="약물 이미지 모의 일치" value={matches} disabled={busy} onValueChange={setMatches}
          trackColor={{ false: '#CAD7D1', true: '#087F72' }} /></View>
      <Button label={running ? '한 칸씩 순차 개폐 중…' : '모의 얼굴 인식 · 안전 검증 시작'} icon="play" disabled={busy || !device}
        onPress={() => { void simulate(simProfile, simSchedule, simTime, matches); }} />
      <View style={styles.guide}><Icon name="volume-2" color={colors.teal} /><Text accessibilityLiveRegion="polite" style={styles.guideText}>{guide}</Text></View>
    </Card>
  </View>;

  if (patient) return <SafeAreaView style={styles.patientRoot}>
    <StatusBar style="light" />
    <View style={styles.patientTop}><View style={s.row}><Icon name="heart" color="#F4D97C" size={26} /><Text style={styles.patientBrand}>메디케어 트레이</Text></View>
      <Button label="보호자 화면" secondary senior disabled={running} onPress={() => { setPatient(false); void Speech.stop().catch(report); }} icon="arrow-left" /></View>
    <ScrollView contentContainerStyle={styles.patientContent}>
      <Text style={styles.patientDemo}>체험 화면 · 실제 카메라 인식과 약 배출은 하지 않습니다</Text>
      <View style={s.wrap}>{device?.profiles.map(p => <Button key={p.id} label={`${p.name} ${p.title}`} senior secondary={p.id !== selectedProfile}
        disabled={running} onPress={() => { setSelectedProfile(p.id); setGuide(idleGuide); }} />)}</View>
      <Avatar profile={patientProfile} large />
      <Text accessibilityRole="header" style={styles.patientGreeting}>{patientProfile ? `${patientProfile.name} ${patientProfile.title}님,\n안녕하세요.` : '보호자에게\n기기 설정을 부탁해 주세요.'}</Text>
      <Text style={styles.patientSubtitle}>{availablePatientSchedule ? `${availablePatientSchedule.label} 약 시간이에요.` : '지금은 확인 가능한 약 시간이 아니에요.'}</Text>
      <View style={styles.patientCard}>
        <Icon name="clock" color={colors.navy} size={34} />
        <Text style={styles.patientTime}>{availablePatientSchedule?.time ?? patientSchedules.find(sc => minutes(sc.time) > currentMinutes)?.time ?? '일정 확인'}</Text>
        <Text style={styles.patientCardText}>{availablePatientSchedule ? '카메라를 바라봐 주세요' : '다음 약 시간까지 편히 쉬세요'}</Text>
        <Text style={styles.patientDetail}>{device ? '기기에 저장된 일정 기준 · 보호자 확인이 필요하면 불러 주세요' : '보호자 화면에서 모의 기기 동기화가 필요해요'}</Text>
      </View>
      <Pressable accessibilityRole="button" disabled={busy || !availablePatientSchedule} style={[styles.patientAction, (busy || !availablePatientSchedule) && { opacity: 0.5 }]}
        onPress={() => { if (availablePatientSchedule) void simulate(selectedProfile, availablePatientSchedule.id, localTime(new Date()), true); }}>
        <Icon name="camera" size={34} color={colors.navy} /><Text style={styles.patientActionText}>{running ? '약통을 한 칸씩 확인해요' : '얼굴 인식 체험하기'}</Text>
      </Pressable>
      <Text accessibilityLiveRegion="polite" style={styles.patientGuide}>{running || guide !== idleGuide ? guide : '이 버튼은 모의 테스트입니다.\n실제 약은 보호자와 함께 확인해 주세요.'}</Text>
      <Button label="안내 다시 듣기" icon="volume-2" secondary senior onPress={() => speak(guide !== idleGuide ? guide : `${patientProfile?.name ?? ''} ${patientProfile?.title ?? ''}님. ${availablePatientSchedule ? `${availablePatientSchedule.label} 약 시간입니다.` : '지금은 확인 가능한 약 시간이 아닙니다.'} 이 화면은 체험용입니다. 실제 약은 보호자와 함께 확인해 주세요.`, true)} />
      <Tray medicines={device?.medicines ?? []} activeBox={activeBox} phase={phase} />
      {toast}
    </ScrollView>
  </SafeAreaView>;

  return <SafeAreaView style={styles.app}>
    <StatusBar style="dark" />
    {desktop && <View style={styles.sidebar}>
      <View style={styles.brand}><View style={styles.brandIcon}><Icon name="heart" color="#BDE5D5" size={25} /></View>
        <View><Text style={styles.brandName}>medicare<Text style={{ color: '#8DC9B6' }}> tray</Text></Text><Text style={styles.brandSub}>매일의 안심을 담다</Text></View></View>
      <Text style={styles.navCaption}>CARE WORKSPACE</Text>
      <View style={{ gap: 6 }}>{navigation.map(nav => <Pressable key={nav.id} accessibilityRole="button"
        accessibilityState={{ selected: page === nav.id }} onPress={() => setPage(nav.id)}
        style={[styles.navItem, page === nav.id && styles.navActive]}>
        <Icon name={nav.icon} size={19} color={page === nav.id ? '#C9EDDD' : '#8FA9AB'} />
        <Text style={[styles.navText, page === nav.id && { color: '#E5F5ED', fontWeight: '600' }]}>{nav.label}</Text>
        {page === nav.id && <View style={styles.navDot} />}
      </Pressable>)}</View>
      <View style={{ flex: 1 }} />
      <View style={styles.sideTip}><View style={s.row}><Icon name="shield" color="#B4DACA" size={18} /><Text style={styles.sideTipTitle}>안전이 가장 먼저예요</Text></View>
        <Text style={styles.sideTipText}>정확한 대상자, 알맞은 시간.{'\n'}세심한 확인이 안심이 됩니다.</Text>
        <View style={styles.sideTipLine} /><Text style={styles.sideTipSmall}>현재는 모의 기기 체험 모드입니다.</Text></View>
      <View style={styles.sideFooter}><View style={styles.caregiverAvatar}><Icon name="user" color="#C0D8D0" size={18} /></View>
        <View><Text style={styles.sideFooterName}>보호자 워크스페이스</Text><Text style={styles.sideFooterSub}>로컬 데모 · 인증 없음</Text></View></View>
    </View>}
    <View style={styles.main}>
      <View style={[styles.header, !desktop && { paddingHorizontal: 20 }]}>
        <View style={s.row}>{!desktop && <Icon name="heart" color={colors.teal} size={24} />}
          <Text style={styles.breadcrumb}>{desktop ? '보호자 공간' : 'medicare tray'}<Text style={{ color: '#9AABA6' }}>  /  </Text>{navigation.find(n => n.id === page)?.label}</Text></View>
        <View style={[s.row, { gap: 14 }]}>{width >= 700 && <Text style={styles.headerDate}>{now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}</Text>}
          <Button label="환자 화면" icon="smile" secondary small onPress={() => { setGuide(idleGuide); setPatient(true); }} disabled={running} /></View>
      </View>
      {!desktop && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mobileNav} contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 10 }}>
        {navigation.map(nav => <Choice key={nav.id} label={nav.label} selected={page === nav.id} onPress={() => setPage(nav.id)} />)}
      </ScrollView>}
      <ScrollView key={page} style={{ flex: 1 }} contentContainerStyle={[styles.content, { padding: desktop ? 34 : 20 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.contentInner}>
          <View style={s.between}><View style={{ gap: 8 }}><View style={s.row}><View style={styles.eyebrowLine} /><Text style={styles.eyebrow}>A LITTLE CARE, EVERY DAY</Text></View>
            <Text accessibilityRole="header" style={[styles.heading, width < 500 && { fontSize: 26 }]}>{pageTitles[page][0]}</Text><Muted>{pageTitles[page][1]}</Muted></View>
            <Badge label="앱 MVP · 시뮬레이션" tone="amber" /></View>
          {toast}
          <View style={styles.demoBanner}><Icon name="info" size={17} color={colors.teal} />
            <Text style={styles.demoText}>예시 데이터로 시작하는 체험용 앱입니다. 실제 연결은 빈 약통 통신 시험 전용이며 AI 인식·자동 알람·실제 복용 확인은 제공하지 않습니다.</Text></View>

          {page === 'overview' && <>
            <View style={[styles.dashboardColumns, !wide && { flexDirection: 'column' }]}>
              <View style={{ flex: 1, gap: 22 }}>
                <View style={styles.hero}>
                  <View style={styles.heroCopy}><View style={s.row}><View style={styles.heroDot} /><Text style={styles.heroEyebrow}>당신의 돌봄에, 든든한 동행</Text></View>
                    <Text style={styles.heroTitle}>약속한 시간에,{'\n'}안심을 전해요.</Text>
                    <Text style={styles.heroDescription}>가족의 하루가 조금 더 편안하도록{'\n'}메디케어 트레이가 함께할게요.</Text>
                    <View style={{ alignSelf: 'flex-start', marginTop: 8 }}><Button label="복약 일정 살펴보기" icon="arrow-right" onPress={() => setPage('schedules')} /></View></View>
                  <View style={styles.heroArt}><View style={styles.orbit}><Icon name="heart" size={34} color={colors.teal} /></View>
                    <View style={styles.artTray}><View style={s.row}><View style={styles.deviceDot} /><Text style={styles.artBrand}>medicare tray</Text></View>
                      <View style={styles.artBoxes}>{[1, 2, 3, 4].map(n => <View key={n} style={styles.artBox}><Text style={styles.artBoxNumber}>{n}</Text><View style={[styles.artPill, n % 2 === 0 && { backgroundColor: '#EDCE8C' }]} /></View>)}</View>
                      <View style={styles.artLight} /></View>
                    <View style={styles.artBadge}><Icon name="shield" size={15} color={colors.teal} /><Text style={styles.artBadgeText}>한 번 더 확인하는 안심</Text></View></View>
                </View>
                <View style={styles.stats}>
                  {[
                    { label: '오늘의 활성 일정', value: totalEnabled, unit: '건', icon: 'calendar' as const, color: colors.teal, bg: colors.mint },
                    { label: '오늘 모의 배출', value: completed, unit: '건', icon: 'check-circle' as const, color: '#5D80A1', bg: '#EBF1F8' },
                    { label: '오늘 안전 차단', value: todayRecords.filter(r => r.status === 'blocked').length, unit: '건', icon: 'shield' as const, color: '#B18A45', bg: '#FCF3E1' },
                  ].map(item => <View key={item.label} style={styles.stat}>
                    <View style={[styles.statIcon, { backgroundColor: item.bg }]}><Icon name={item.icon} size={18} color={item.color} /></View>
                    <Text style={styles.statLabel}>{item.label}</Text><Text style={styles.statValue}>{item.value}<Text style={styles.statUnit}> {item.unit}</Text></Text>
                  </View>)}
                </View>
                <Card>
                  <View style={s.between}><View style={s.row}><Text style={styles.cardTitle}>오늘의 복약 일정</Text><Badge label={now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} tone="gray" /></View>
                    <Button label="일정 추가" small secondary icon="plus" disabled={busy} onPress={() => setForm({ kind: 'schedule' })} /></View>
                  {profileSelector}
                  {schedules.length ? <View>{schedules.map(renderSchedule)}</View> : <Empty title="등록된 일정이 없어요" description="대상자의 약을 먼저 등록하고 일정을 추가해 주세요." />}
                  <View style={styles.cardFoot}><Icon name="info" size={15} color={colors.muted} /><Muted>시간과 약의 종류는 반드시 처방 내용에 따라 설정해 주세요.</Muted></View>
                </Card>
              </View>
              <View style={[styles.rightColumn, !wide && { width: '100%' }]}>
                <Card>
                  <View style={s.between}><Text style={styles.cardTitle}>우리 가족</Text><Button label="관리" small secondary onPress={() => setPage('people')} /></View>
                  {profile ? <><View style={s.row}><Avatar profile={profile} large /><View style={{ gap: 5 }}><Text style={styles.personName}>{profile.name} <Text style={styles.personTitle}>{profile.title}</Text></Text><Badge label="보호자 등록 대상자" tone="gray" /></View></View>
                    <View style={styles.familyNote}><Icon name="sun" size={20} color="#AC8B42" /><View style={{ flex: 1 }}><Label>{nextSchedule ? `다음 일정은 ${nextSchedule.time}` : '오늘의 일정을 확인해 주세요'}</Label><Muted>{nextSchedule ? `${nextSchedule.label} 약 · 모의 배출 전` : '기록은 실제 복용 여부와 다를 수 있어요.'}</Muted></View></View></>
                    : <Empty title="가족을 등록해 주세요" description="대상자 관리에서 시작할 수 있어요." />}
                  <View style={styles.progressHeader}><Muted>전체 활성 일정 · 모의 배출 비율</Muted><Text style={styles.progressValue}>{progress}%</Text></View>
                  <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
                  <Text style={styles.fineprint}>실제 복약 이행률이 아닌 테스트 진행률입니다.</Text>
                </Card>
                <Card>
                  <View style={s.between}><Text style={styles.cardTitle}>내 스마트 약통</Text><Badge label={online ? '모의 연결' : '모의 오프라인'} tone={online ? 'mint' : 'gray'} /></View>
                  <Tray medicines={device?.medicines ?? []} activeBox={activeBox} phase={phase} />
                  <View style={s.row}><Icon name={synchronized ? 'check-circle' : 'alert-circle'} size={16} color={synchronized ? colors.teal : colors.amber} />
                    <Text style={styles.syncText}>{synchronized ? '최신 앱 설정이 모의 기기에 저장됨' : '설정 동기화가 필요해요'}</Text></View>
                  <Button label="기기 확인 및 테스트" secondary icon="arrow-right" onPress={() => setPage('device')} />
                </Card>
                <View style={styles.careQuote}><Icon name="heart" color="#8AAE9C" size={19} /><Text style={styles.quoteText}>작은 챙김이 모여,{'\n'}가족의 편안한 하루가 됩니다.</Text></View>
              </View>
            </View>
            <Card><View style={s.between}><Text style={styles.cardTitle}>최근 활동</Text><Button label="전체 기록" secondary small onPress={() => setPage('history')} /></View>
              {data.records.length ? data.records.slice(0, 3).map(renderRecord) : <Empty title="아직 활동 기록이 없어요" description="기기 연결 화면에서 모의 시나리오를 실행하면 기록이 남아요." />}</Card>
          </>}
          {page === 'schedules' && <Card>
            <View style={s.between}><View><Text style={styles.cardTitle}>등록된 복약 일정</Text><Muted>총 {data.schedules.length}개 · 변경 후 기기 동기화 필요</Muted></View>
              <Button label="일정 추가" icon="plus" disabled={busy} onPress={() => setForm({ kind: 'schedule' })} /></View>
            {allSchedules.length ? allSchedules.map(renderSchedule) : <Empty title="복약 일정을 등록해 주세요" description="약 등록 후 아침, 점심, 저녁 시간을 지정할 수 있어요." />}
          </Card>}
          {page === 'people' && <>
            <View style={s.between}><Label>등록 대상자 {data.profiles.length}명</Label><Button label="대상자 등록" icon="user-plus" disabled={busy} onPress={() => setForm({ kind: 'profile' })} /></View>
            <View style={styles.tileGrid}>{data.profiles.map(p => <Card key={p.id} style={styles.personTile}>
              <View style={s.row}><Avatar profile={p} large /><View><Text style={styles.personName}>{p.name} <Text style={styles.personTitle}>{p.title}</Text></Text><Muted>일정 {data.schedules.filter(sc => sc.profileId === p.id).length}개 · 약 {data.medicines.filter(m => m.profileId === p.id).length}개</Muted></View></View>
              <Badge label={p.faceUri ? '참고 사진 등록됨 · AI 학습 아님' : '참고 사진 미등록'} tone="gray" />
              <View style={s.wrap}><Button label="정보 수정" secondary icon="edit-2" disabled={busy} onPress={() => setForm({ kind: 'profile', item: p })} />
                <Button label="음성 미리 듣기" secondary icon="volume-2" onPress={() => speak(`${p.name} ${p.title}님, 아침 약 드실 시간이에요. 카메라를 바라봐 주세요.`, true)} />
                <Button label="삭제" danger disabled={busy} onPress={() => deleteProfile(p)} /></View>
            </Card>)}</View>
            {!data.profiles.length && <Card><Empty title="첫 대상자를 등록해 주세요" description="성함과 부르고 싶은 칭호를 지정할 수 있어요." /></Card>}
            <Card><Label>사진과 개인정보 안내</Label><Muted>사진은 이 앱의 로컬 저장 공간에만 보관됩니다. 얼굴 인식 학습이나 본인 확인에는 사용되지 않습니다. 암호화·접근 인증은 구현되지 않았으므로 실제 환자의 민감한 정보 대신 테스트 데이터를 사용해 주세요.</Muted></Card>
          </>}
          {page === 'medicines' && <>
            <View style={s.between}><Label>스마트 약통 4칸 · {data.medicines.length}칸 등록</Label><Button label="약 등록" icon="plus" disabled={busy || data.medicines.length >= 4} onPress={() => setForm({ kind: 'medicine' })} /></View>
            <Tray medicines={data.medicines} />
            <View style={styles.tileGrid}>{[1, 2, 3, 4].map(box => {
              const med = data.medicines.find(m => m.box === box);
              const owner = data.profiles.find(p => p.id === med?.profileId);
              return <Card key={box} style={styles.medicineTile}>
                <View style={s.between}><View style={s.row}><View style={styles.boxTag}><Text style={styles.boxTagText}>{String(box).padStart(2, '0')}</Text></View><Text style={styles.cardTitle}>{box}번 약통</Text></View>
                  <Badge label={med ? '등록됨' : '비어 있음'} tone={med ? 'mint' : 'gray'} /></View>
                {med ? <><View style={s.row}>{med.imageUri ? <Image source={{ uri: med.imageUri }} style={styles.medicineImage} accessibilityLabel={`${med.name} 참고 사진`} /> : <View style={styles.medicinePlaceholder}><Icon name="package" color={colors.teal} size={30} /></View>}
                  <View style={{ flex: 1, gap: 5 }}><Label>{med.name}</Label><Muted>{owner?.name} {owner?.title} 전용</Muted></View></View>
                  <View style={s.wrap}><Button label="수정" secondary small disabled={busy} onPress={() => setForm({ kind: 'medicine', item: med })} /><Button label="삭제" danger small disabled={busy} onPress={() => deleteMedicine(med)} /></View></>
                  : <View style={{ gap: 14 }}><Muted>아직 연결된 약이 없어요.</Muted><Button label="이 칸에 약 등록" secondary icon="plus" disabled={busy} onPress={() => setForm({ kind: 'medicine', item: { id: '', profileId: selectedProfile, name: '', box } })} /></View>}
              </Card>;
            })}</View>
            <View style={styles.demoBanner}><Icon name="alert-circle" size={18} color={colors.teal} /><Text style={styles.demoText}>사진과 약통 번호는 참고용 등록입니다. 약의 용량·성분을 판별하거나 처방의 적절성을 검증하지 않습니다.</Text></View>
          </>}
          {page === 'device' && devicePanel}
          {page === 'history' && <Card><View style={s.between}><Text style={styles.cardTitle}>모의 기기 활동 기록</Text><Badge label={`${data.records.length}건 · 로컬 저장`} tone="gray" /></View>
            <Muted>배출은 복용 확인이 아닙니다. 중단된 테스트는 재배출을 막기 위해 ‘확인 필요’로 남습니다. 안전 이력은 앱에서 삭제할 수 없습니다.</Muted>
            {data.records.length ? data.records.map(renderRecord) : <Empty title="기록이 없어요" description="모의 기기에 동기화하고 안전 시나리오를 테스트해 보세요." />}</Card>}
          <View style={styles.voiceFooter}><View style={s.row}><Icon name="volume-2" color={colors.muted} size={17} /><Muted>한국어 음성 자동 안내</Muted>
            <Switch accessibilityLabel="한국어 음성 안내 사용" value={voice} onValueChange={enabled => { setVoice(enabled); if (!enabled) void Speech.stop().catch(report); }}
              trackColor={{ false: '#CAD7D1', true: '#087F72' }} /></View><Text style={styles.fineprint}>음색은 기기의 TTS 설정에 따라 달라집니다. · Medicare Tray MVP</Text></View>
        </View>
      </ScrollView>
    </View>
    {form && <Editor key={`${form.kind}-${form.item?.id ?? 'new'}`} form={form} data={data} selectedProfile={selectedProfile}
      onClose={() => setForm(null)} onSave={async update => {
        await configure(update); setForm(null); flash('앱에 저장했어요. 기기에 반영하려면 설정을 동기화해 주세요.');
      }} />}
    {confirmation && <Dialog title={confirmation.title} onClose={() => setConfirmation(null)}>
      <Muted>{confirmation.text}</Muted><Button label="삭제하기" danger disabled={busy} onPress={() => {
        void confirmation.action().then(() => { setConfirmation(null); flash('앱에서 삭제했어요. 기기에 반영하려면 다시 동기화해 주세요.'); }).catch(report);
      }} /><Button label="취소" secondary onPress={() => setConfirmation(null)} />
    </Dialog>}
  </SafeAreaView>;
}

function Editor({ form, data, selectedProfile, onClose, onSave }: {
  form: Form; data: AppData; selectedProfile: string; onClose: () => void;
  onSave: (update: Partial<Configuration>) => Promise<void>;
}) {
  const item = form.item;
  const [name, setName] = useState(form.kind === 'schedule' ? form.item?.label ?? '아침' : form.item?.name ?? '');
  const [title, setTitle] = useState(form.kind === 'profile' ? form.item?.title ?? '할머니' : '');
  const [profileId, setProfileId] = useState(form.kind !== 'profile' ? form.item?.profileId ?? selectedProfile : selectedProfile);
  const [time, setTime] = useState(form.kind === 'schedule' ? form.item?.time ?? '08:00' : '');
  const [box, setBox] = useState(form.kind === 'medicine' ? form.item?.box ?? [1, 2, 3, 4].find(n => !data.medicines.some(m => m.box === n)) ?? 1 : 1);
  const [medicineIds, setMedicineIds] = useState<string[]>(form.kind === 'schedule' ? form.item?.medicineIds ?? [] : []);
  const [imageUri, setImageUri] = useState(form.kind === 'profile' ? form.item?.faceUri : form.kind === 'medicine' ? form.item?.imageUri : undefined);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const existing = Boolean(item?.id);
  const pickImage = async () => {
    setError('');
    setPicking(true);
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) throw new Error('사진 접근 권한이 필요합니다. 기기 설정에서 허용해 주세요.');
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.5 });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.base64) throw new Error('사진을 읽지 못했습니다. JPG, PNG, WebP 사진을 선택해 주세요.');
      const mime = asset.mimeType ?? 'image/jpeg';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('JPG, PNG, WebP 사진만 지원합니다.');
      const uri = `data:${mime};base64,${asset.base64}`;
      if (uri.length > 4_200_000) throw new Error('사진이 너무 큽니다. 3MB 이하의 사진을 선택해 주세요.');
      setImageUri(uri);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '사진을 불러오지 못했습니다.'); }
    finally { setPicking(false); }
  };
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (!name.trim()) throw new Error('이름 또는 시간대 이름을 입력해 주세요.');
      if (form.kind === 'profile') {
        if (!title.trim()) throw new Error('칭호를 입력해 주세요.');
        const profile: Profile = { id: item?.id || id(), name: name.trim(), title: title.trim(), faceUri: imageUri };
        await onSave({ profiles: existing ? data.profiles.map(p => p.id === profile.id ? profile : p) : [...data.profiles, profile] });
      } else if (form.kind === 'medicine') {
        const med: Medicine = { id: item?.id || id(), name: name.trim(), profileId, box, imageUri };
        await onSave({ medicines: existing ? data.medicines.map(m => m.id === med.id ? med : m) : [...data.medicines, med] });
      } else {
        const schedule: Schedule = { id: item?.id || id(), profileId, label: name.trim(), time: time.trim(), medicineIds, enabled: form.item?.enabled ?? true };
        await onSave({ schedules: existing ? data.schedules.map(sc => sc.id === schedule.id ? schedule : sc) : [...data.schedules, schedule] });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다. 저장 공간을 확인해 주세요.'); }
    finally { setSaving(false); }
  };
  return <Dialog title={`${form.kind === 'profile' ? '대상자' : form.kind === 'medicine' ? '약' : '복약 일정'} ${existing ? '수정' : '등록'}`} onClose={() => { if (!saving && !picking) onClose(); }}>
    {form.kind !== 'profile' && <View style={{ gap: 10 }}><Label>대상자</Label><View style={s.wrap}>{data.profiles.map(p =>
      <Choice key={p.id} label={`${p.name} ${p.title}`} selected={profileId === p.id} disabled={saving || picking}
        onPress={() => { setProfileId(p.id); setMedicineIds([]); }} />)}</View>
      {!data.profiles.length && <Text style={styles.warningText}>대상자를 먼저 등록해 주세요.</Text>}</View>}
    <Field label={form.kind === 'schedule' ? '시간대 이름' : form.kind === 'profile' ? '성함' : '약 이름 (처방전 기준)'}
      value={name} onChangeText={setName} placeholder={form.kind === 'schedule' ? '아침' : form.kind === 'profile' ? '홍길동' : '예: 아침 약 A'} maxLength={40} />
    {form.kind === 'profile' && <><Field label="불러드릴 칭호" value={title} onChangeText={setTitle} placeholder="할머니" maxLength={16} />
      <View style={s.wrap}>{['할머니', '할아버지', '어머니', '아버지'].map(value => <Choice key={value} label={value} selected={title === value} onPress={() => setTitle(value)} />)}</View></>}
    {form.kind === 'medicine' && <View style={{ gap: 10 }}><Label>연결할 약통</Label><View style={s.wrap}>{[1, 2, 3, 4].map(n => <Choice key={n}
      label={`${n}번${data.medicines.some(m => m.box === n && m.id !== item?.id) ? ' (사용 중)' : ''}`}
      selected={box === n} onPress={() => setBox(n)} disabled={data.medicines.some(m => m.box === n && m.id !== item?.id)} />)}</View></View>}
    {form.kind === 'schedule' && <><Field label="복약 시간 (24시간 HH:MM)" value={time} onChangeText={setTime} placeholder="08:00" maxLength={5} />
      <Label>함께 열 약통 (여러 개 선택 가능)</Label><View style={s.wrap}>{data.medicines.filter(m => m.profileId === profileId).map(m =>
        <Choice key={m.id} label={`${m.box}번 · ${m.name}`} selected={medicineIds.includes(m.id)}
          onPress={() => setMedicineIds(previous => previous.includes(m.id) ? previous.filter(mid => mid !== m.id) : [...previous, m.id])} />)}</View>
      {!data.medicines.some(m => m.profileId === profileId) && <Text style={styles.warningText}>선택한 대상자의 약을 먼저 등록해 주세요.</Text>}
      <Muted>선택한 약통은 번호순으로 한 칸씩 열고 닫습니다. 실제 투약량을 지정하는 기능은 아닙니다.</Muted></>}
    {form.kind !== 'schedule' && <View style={{ gap: 12 }}>
      <Label>{form.kind === 'profile' ? '얼굴 참고 사진' : '약물 참고 사진'} (선택)</Label>
      {imageUri && <Image source={{ uri: imageUri }} style={styles.imagePreview} accessibilityLabel="선택한 참고 사진" />}
      <View style={s.wrap}><Button label={picking ? '사진 읽는 중…' : '사진 선택'} icon="image" secondary onPress={() => { void pickImage(); }} disabled={saving || picking} />
        {imageUri && <Button label="사진 제거" danger small onPress={() => setImageUri(undefined)} disabled={saving || picking} />}</View>
      <Muted>로컬 저장만 지원합니다. AI 학습·약 식별 기능은 없으므로 테스트 사진을 사용해 주세요.</Muted>
    </View>}
    {error !== '' && <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>}
    <Button label={saving ? '저장 중…' : '저장하기'} icon="check" disabled={saving || picking} onPress={() => { void save(); }} />
  </Dialog>;
}

const styles = StyleSheet.create({
  app: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 22, backgroundColor: colors.background },
  sidebar: { width: 242, backgroundColor: colors.navy, paddingHorizontal: 19, paddingTop: 35, paddingBottom: 23 },
  brand: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 6 },
  brandIcon: { width: 40, height: 44, borderRadius: 13, backgroundColor: '#26464B', alignItems: 'center', justifyContent: 'center' },
  brandName: { color: '#F4F8F4', fontSize: 19, fontWeight: '700', letterSpacing: -0.7 },
  brandSub: { fontSize: 10, color: '#8BA8A7', marginTop: 5, letterSpacing: 1.3 },
  navCaption: { color: '#789596', fontSize: 9, letterSpacing: 2.1, fontWeight: '600', marginTop: 52, marginBottom: 18, paddingHorizontal: 14 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 50, paddingHorizontal: 16, borderRadius: 11 },
  navActive: { backgroundColor: '#2C4C4F' },
  navText: { color: '#9FB5B4', fontSize: 13 },
  navDot: { marginLeft: 'auto', width: 5, height: 5, borderRadius: 3, backgroundColor: '#9ACDB7' },
  sideTip: { padding: 17, gap: 12, borderRadius: 13, borderWidth: 1, borderColor: '#365357', backgroundColor: '#1E3A41' },
  sideTipTitle: { fontSize: 12, color: '#D5E6DE', fontWeight: '600' },
  sideTipText: { color: '#96AFAB', fontSize: 11, lineHeight: 21 },
  sideTipLine: { height: 1, backgroundColor: '#365357' },
  sideTipSmall: { color: '#8EA7A5', fontSize: 9, lineHeight: 17 },
  sideFooter: { borderTopWidth: 1, borderColor: '#365357', marginTop: 22, paddingTop: 22, flexDirection: 'row', gap: 10, alignItems: 'center' },
  caregiverAvatar: { width: 35, height: 35, borderRadius: 12, backgroundColor: '#345052', alignItems: 'center', justifyContent: 'center' },
  sideFooterName: { fontSize: 11, color: '#CFDFD9', fontWeight: '600' },
  sideFooterSub: { fontSize: 9, color: '#91A9A6', marginTop: 5 },
  main: { flex: 1, minWidth: 0 },
  header: { minHeight: 78, paddingHorizontal: 34, paddingVertical: 14, backgroundColor: '#FFFFFF', borderBottomWidth: 1,
    borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  breadcrumb: { fontSize: 12, color: colors.muted, fontWeight: '500' },
  headerDate: { fontSize: 12, color: colors.muted },
  mobileNav: { flexGrow: 0, maxHeight: 66, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  content: { flexGrow: 1 },
  contentInner: { width: '100%', maxWidth: 1400, alignSelf: 'center', gap: 24 },
  eyebrowLine: { width: 19, height: 2, backgroundColor: '#86B19E' },
  eyebrow: { fontSize: 9, color: '#7F9B8C', fontWeight: '700', letterSpacing: 1.9 },
  heading: { fontSize: 29, fontWeight: '700', color: colors.navy, letterSpacing: -1.1, lineHeight: 41 },
  demoBanner: { paddingHorizontal: 17, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#EAF3EC', borderRadius: 10 },
  demoText: { flex: 1, fontSize: 12, color: '#466F60', lineHeight: 20 },
  dashboardColumns: { flexDirection: 'row', gap: 24, alignItems: 'stretch' },
  rightColumn: { width: 316, gap: 22 },
  hero: { minHeight: 282, padding: 27, borderRadius: 19, backgroundColor: '#E6EFE5', flexDirection: 'row', alignItems: 'center', overflow: 'hidden', flexWrap: 'wrap', gap: 15 },
  heroCopy: { flex: 1, minWidth: 210, gap: 13, zIndex: 1 },
  heroDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#65947A' },
  heroEyebrow: { color: '#547C64', fontSize: 10, fontWeight: '600' },
  heroTitle: { color: '#234C3C', fontSize: 31, fontWeight: '700', letterSpacing: -1.1, lineHeight: 43 },
  heroDescription: { color: '#62806C', fontSize: 12, lineHeight: 22 },
  heroArt: { width: 220, height: 218, alignItems: 'center', justifyContent: 'center' },
  orbit: { width: 180, height: 180, borderRadius: 90, backgroundColor: '#D5E5D4', position: 'absolute', top: 0, right: -17, alignItems: 'center', paddingTop: 20, transform: [{ rotate: '-15deg' }] },
  artTray: { width: 210, height: 115, borderRadius: 17, backgroundColor: '#FAFCF7', borderColor: '#C7D9C8', borderWidth: 1, padding: 14,
    transform: [{ rotate: '-7deg' }], boxShadow: '0px 16px 24px rgba(43, 78, 49, 0.14)', marginTop: 32 },
  artBrand: { fontSize: 8, fontWeight: '600', color: '#638373' },
  artBoxes: { flexDirection: 'row', gap: 6, marginTop: 11 },
  artBox: { flex: 1, height: 48, borderRadius: 7, borderColor: '#D6E3D6', borderWidth: 1, backgroundColor: '#EDF3E9', alignItems: 'center', justifyContent: 'center' },
  artBoxNumber: { position: 'absolute', top: 4, left: 5, fontSize: 7, color: '#8DA18D' },
  artPill: { width: 22, height: 10, borderRadius: 8, backgroundColor: '#ADCDB5', transform: [{ rotate: '-35deg' }] },
  artLight: { width: 20, height: 3, borderRadius: 3, backgroundColor: '#91BDA2', alignSelf: 'center', marginTop: 9 },
  artBadge: { backgroundColor: colors.white, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10, flexDirection: 'row', gap: 7, alignItems: 'center', marginTop: 10, marginLeft: 25,
    transform: [{ rotate: '-4deg' }] },
  artBadgeText: { fontSize: 9, color: '#4D715A', fontWeight: '600' },
  stats: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  stat: { flex: 1, minWidth: 112, backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, padding: 18, borderRadius: 15, gap: 8 },
  statIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statLabel: { color: colors.muted, fontSize: 11 },
  statValue: { color: colors.navy, fontSize: 29, fontWeight: '700' },
  statUnit: { fontSize: 12, fontWeight: '500', color: colors.muted },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.navy, lineHeight: 25, letterSpacing: -0.4 },
  scheduleRow: { paddingVertical: 20, flexDirection: 'row', alignItems: 'center', gap: 15, flexWrap: 'wrap', borderTopWidth: 1, borderTopColor: '#EEF1ED' },
  timeIcon: { width: 46, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  time: { fontSize: 23, fontWeight: '600', letterSpacing: -0.8, color: colors.navy, lineHeight: 31, fontVariant: ['tabular-nums'] },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 8 },
  avatar: { width: 43, height: 43, borderRadius: 15, overflow: 'hidden', backgroundColor: '#EDF3EA', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DDE8DB' },
  avatarLarge: { width: 62, height: 66, borderRadius: 22 },
  personName: { fontSize: 21, color: colors.navy, fontWeight: '700', lineHeight: 31 },
  personTitle: { fontSize: 13, fontWeight: '500', color: colors.muted },
  familyNote: { backgroundColor: '#F8F8F0', borderRadius: 11, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5, flexWrap: 'wrap' },
  progressValue: { color: colors.teal, fontSize: 15, fontWeight: '700' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#EAF0E8', overflow: 'hidden', marginTop: -6 },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: '#6DA68C' },
  fineprint: { fontSize: 10, color: '#7B8E88', lineHeight: 18 },
  tray: { backgroundColor: '#F3F5EF', borderWidth: 1, borderColor: '#DEE5DA', borderRadius: 15, padding: 15, gap: 18, minWidth: 0 },
  deviceDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#68A986' },
  deviceBrand: { fontSize: 8, fontWeight: '700', color: '#7D9284', letterSpacing: 1.3 },
  trayBoxes: { flexDirection: 'row', gap: 7 },
  trayBox: { flex: 1, minWidth: 0, minHeight: 85, backgroundColor: '#FEFFF9', borderRadius: 9, borderWidth: 1, borderColor: '#DDE5D8', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 7 },
  trayBoxActive: { backgroundColor: '#DBF3E9', borderColor: colors.teal, borderWidth: 2 },
  boxNumber: { fontSize: 10, color: '#869B8B', fontWeight: '600' },
  pill: { width: 23, height: 11, borderRadius: 8, backgroundColor: '#D2C8AB', overflow: 'hidden', transform: [{ rotate: '-35deg' }], flexDirection: 'row' },
  pillHalf: { width: '50%', backgroundColor: '#E8E1CA' },
  boxCaption: { fontSize: 8, color: '#7F9583' },
  trayFoot: { fontSize: 6, color: '#8B9F8F', letterSpacing: 0.7 },
  syncInfo: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#F4F8F2', borderRadius: 9, padding: 12 },
  syncText: { color: '#6B8077', fontSize: 11, lineHeight: 19, flexShrink: 1 },
  careQuote: { padding: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 13 },
  quoteText: { color: '#879B8C', fontSize: 12, lineHeight: 22 },
  recordRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 13, borderTopWidth: 1, borderColor: '#EEF1ED', paddingVertical: 16, flexWrap: 'wrap' },
  recordIcon: { width: 33, height: 33, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  recordDate: { color: '#8B9A94', fontSize: 10, lineHeight: 18 },
  notice: { padding: 14, backgroundColor: '#E6F3ED', borderColor: '#A4D3BD', borderWidth: 1, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  noticeError: { backgroundColor: '#FDF0EA', borderColor: '#E4B5A4' },
  noticeText: { flex: 1, color: colors.teal, fontSize: 13, lineHeight: 22 },
  warningText: { color: colors.amber, fontSize: 13, lineHeight: 22 },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 23 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  personTile: { flexGrow: 1, flexBasis: 390, minWidth: 0, maxWidth: 700 },
  medicineTile: { flexGrow: 1, flexBasis: 390, minWidth: 0, maxWidth: 700 },
  boxTag: { backgroundColor: colors.mint, width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  boxTagText: { color: colors.teal, fontSize: 18, fontWeight: '700' },
  medicineImage: { width: 65, height: 65, borderRadius: 12 },
  medicinePlaceholder: { width: 65, height: 65, backgroundColor: '#F2F6EF', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  imagePreview: { width: 100, height: 100, borderRadius: 14 },
  sectionIcon: { backgroundColor: colors.mint, padding: 14, borderRadius: 14 },
  guide: { backgroundColor: colors.mint, borderRadius: 12, padding: 18, flexDirection: 'row', gap: 13, alignItems: 'center' },
  guideText: { flex: 1, fontSize: 16, lineHeight: 27, color: colors.teal, fontWeight: '500' },
  voiceFooter: { paddingTop: 7, paddingBottom: 5, borderTopWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 15, flexWrap: 'wrap' },
  patientRoot: { flex: 1, backgroundColor: '#122C36' },
  patientTop: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' },
  patientBrand: { color: '#FFF6DC', fontSize: 32, fontWeight: '700' },
  patientContent: { alignItems: 'center', padding: 24, gap: 28, width: '100%', maxWidth: 850, alignSelf: 'center' },
  patientDemo: { color: '#F2DA90', fontSize: 32, lineHeight: 46, textAlign: 'center' },
  patientGreeting: { color: '#FFF5CF', fontSize: 44, fontWeight: '700', textAlign: 'center', lineHeight: 62 },
  patientSubtitle: { color: '#FFF5CF', fontSize: 32, lineHeight: 46, textAlign: 'center' },
  patientCard: { width: '100%', alignItems: 'center', backgroundColor: '#FFFAE8', padding: 30, borderRadius: 24, gap: 16 },
  patientTime: { color: colors.navy, fontSize: 64, lineHeight: 80, fontWeight: '700', fontVariant: ['tabular-nums'] },
  patientCardText: { color: colors.navy, fontSize: 32, lineHeight: 46, textAlign: 'center', fontWeight: '700' },
  patientDetail: { color: '#354F56', fontSize: 32, lineHeight: 46, textAlign: 'center' },
  patientAction: { width: '100%', backgroundColor: '#F3D26B', borderRadius: 20, minHeight: 90, padding: 20, flexDirection: 'row', gap: 18, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  patientActionText: { color: colors.navy, fontWeight: '700', fontSize: 32, lineHeight: 46 },
  patientGuide: { color: '#E3EFE7', fontSize: 32, lineHeight: 48, textAlign: 'center' },
});
