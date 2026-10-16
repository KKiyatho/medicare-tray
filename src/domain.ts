export type Profile = { id: string; name: string; title: string; faceUri?: string };
export type Medicine = { id: string; profileId: string; name: string; box: number; imageUri?: string };
export type Schedule = {
  id: string;
  profileId: string;
  label: string;
  time: string;
  medicineIds: string[];
  enabled: boolean;
};
export type Configuration = { profiles: Profile[]; medicines: Medicine[]; schedules: Schedule[] };
export type DeviceSnapshot = Configuration & { revision: number; syncedAt: string };
export type RecordStatus = 'dispensing' | 'dispensed' | 'blocked' | 'interrupted';
export type DoseRecord = {
  id: string;
  profileId: string;
  scheduleId: string;
  profileName: string;
  scheduleLabel: string;
  day: string;
  at: string;
  status: RecordStatus;
  message: string;
  boxes: number[];
};
export type AppData = Configuration & {
  version: 1;
  revision: number;
  device: DeviceSnapshot | null;
  records: DoseRecord[];
};

export const WINDOW_MINUTES = 30;
export const STORAGE_KEY = 'medicare-tray:v1';
export const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const localTime = (date: Date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
export const validTime = (value: string) => value.length === 5 && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

export function seedData(): AppData {
  return {
    version: 1,
    revision: 1,
    profiles: [
      { id: 'youngsun', name: '김영순', title: '할머니' },
      { id: 'jungho', name: '박정호', title: '할아버지' },
    ],
    medicines: [
      { id: 'med-a', profileId: 'youngsun', name: '아침 약 A (예시)', box: 1 },
      { id: 'med-b', profileId: 'youngsun', name: '저녁 약 B (예시)', box: 2 },
      { id: 'med-c', profileId: 'jungho', name: '아침 약 C (예시)', box: 3 },
    ],
    schedules: [
      { id: 'morning', profileId: 'youngsun', label: '아침', time: '08:00', medicineIds: ['med-a'], enabled: true },
      { id: 'evening', profileId: 'youngsun', label: '저녁', time: '18:30', medicineIds: ['med-b'], enabled: true },
      { id: 'morning-j', profileId: 'jungho', label: '아침', time: '08:30', medicineIds: ['med-c'], enabled: true },
    ],
    device: null,
    records: [],
  };
}

export function validateConfiguration(config: Configuration): void {
  const unique = (values: string[]) => new Set(values).size === values.length;
  const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  const image = (value: unknown) =>
    value === undefined || (typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(value) && value.length <= 4_200_000);
  if (!Array.isArray(config.profiles) || !Array.isArray(config.medicines) || !Array.isArray(config.schedules)) {
    throw new Error('설정 데이터 형식이 올바르지 않습니다.');
  }
  if (config.profiles.some(p => !p || !text(p.id) || !text(p.name) || !text(p.title) || !image(p.faceUri)) ||
      !unique(config.profiles.map(p => p.id))) throw new Error('대상자 정보를 확인해 주세요.');
  if (config.medicines.some(m => !m || !text(m.id) || !text(m.name) || !config.profiles.some(p => p.id === m.profileId) ||
      !Number.isInteger(m.box) || m.box < 1 || m.box > 4 || !image(m.imageUri)) ||
      !unique(config.medicines.map(m => m.id)) || !unique(config.medicines.map(m => String(m.box)))) {
    throw new Error('약통은 1~4번이며 한 칸에는 하나의 약 등록만 연결할 수 있습니다.');
  }
  if (config.schedules.some(s => !s || !text(s.id) || !text(s.label) || typeof s.time !== 'string' || !validTime(s.time) ||
      typeof s.enabled !== 'boolean' || !config.profiles.some(p => p.id === s.profileId) ||
      !Array.isArray(s.medicineIds) || s.medicineIds.length === 0 || !unique(s.medicineIds) ||
      s.medicineIds.some(mid => !config.medicines.some(m => m.id === mid && m.profileId === s.profileId))) ||
      !unique(config.schedules.map(s => s.id))) throw new Error('일정의 시간, 대상자, 연결된 약을 확인해 주세요.');
}

export function validateData(value: unknown): asserts value is AppData {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) {
    throw new Error('지원하지 않는 저장 데이터입니다. 기존 데이터를 덮어쓰지 않았습니다.');
  }
  const data = value as AppData;
  validateConfiguration(data);
  if (!Number.isSafeInteger(data.revision) || data.revision < 1 || !Array.isArray(data.records)) throw new Error('저장 데이터가 손상되었습니다.');
  if (data.device !== null) {
    if (!data.device || !Number.isSafeInteger(data.device.revision) || data.device.revision < 1 ||
        data.device.revision > data.revision || !Number.isFinite(Date.parse(data.device.syncedAt))) throw new Error('기기 설정이 손상되었습니다.');
    validateConfiguration(data.device);
  }
  if (data.records.some(r => !r || typeof r.id !== 'string' || typeof r.profileId !== 'string' ||
      typeof r.scheduleId !== 'string' || typeof r.profileName !== 'string' || typeof r.scheduleLabel !== 'string' ||
      !['dispensing', 'dispensed', 'blocked', 'interrupted'].includes(r.status) ||
      !Number.isFinite(Date.parse(r.at)) || !/^\d{4}-\d{2}-\d{2}$/.test(r.day) ||
      typeof r.message !== 'string' || !Array.isArray(r.boxes) ||
      r.boxes.some(b => !Number.isInteger(b) || b < 1 || b > 4))) throw new Error('이력 데이터가 손상되었습니다.');
}

export function updateConfiguration(data: AppData, update: Partial<Configuration>): AppData {
  const next = { ...data, ...update, revision: data.revision + 1 };
  validateConfiguration(next);
  return next;
}

export function syncDevice(data: AppData, now = new Date()): AppData {
  validateConfiguration(data);
  return {
    ...data,
    device: JSON.parse(JSON.stringify({
      profiles: data.profiles, medicines: data.medicines, schedules: data.schedules,
      revision: data.revision, syncedAt: now.toISOString(),
    })) as DeviceSnapshot,
  };
}

export type Attempt = {
  profileId: string;
  scheduleId: string;
  medicineMatches: boolean;
  now: Date;
  clockTime: string;
};
export type Decision = { allowed: boolean; message: string; record: DoseRecord };

export function decideDispense(data: AppData, attempt: Attempt): Decision {
  const { device } = data;
  const schedule = device?.schedules.find(s => s.id === attempt.scheduleId);
  const profile = device?.profiles.find(p => p.id === attempt.profileId);
  const day = localDay(attempt.now);
  const selected = device?.medicines.filter(m => schedule?.medicineIds.includes(m.id)) ?? [];
  let reason = '';
  if (!device) reason = '먼저 보호자 화면에서 모의 기기에 설정을 동기화해 주세요.';
  else if (!profile) reason = '등록된 얼굴이 아닙니다. 보호자를 불러 주세요.';
  else if (!schedule || !schedule.enabled) reason = '사용 가능한 복약 일정이 아닙니다.';
  else if (schedule.profileId !== profile.id) reason = `${profile.name} ${profile.title}님의 약이 아닙니다. 드시면 안 돼요.`;
  else if (!validTime(attempt.clockTime) ||
      minutes(attempt.clockTime) < minutes(schedule.time) ||
      minutes(attempt.clockTime) >= minutes(schedule.time) + WINDOW_MINUTES) reason = '지금은 설정된 약 시간이 아니에요. 보호자에게 확인해 주세요.';
  else if (data.records.some(r => r.day === day && r.scheduleId === schedule.id && r.status !== 'blocked')) {
    reason = '이미 배출되었거나 배출 확인이 필요한 일정입니다. 중복 배출을 막았어요.';
  } else if (selected.length !== schedule.medicineIds.length || selected.some(m => m.profileId !== profile.id)) {
    reason = '약통 설정이 올바르지 않습니다. 보호자가 설정을 확인해야 합니다.';
  } else if (!attempt.medicineMatches) reason = '올바른 약이 아닙니다. 약을 다시 확인해 주세요.';
  const boxes = reason ? [] : selected.map(m => m.box).sort((a, b) => a - b);
  const message = reason || `${profile!.name} ${profile!.title}님, ${schedule!.label} 약통을 한 칸씩 열어드릴게요.`;
  return {
    allowed: !reason,
    message,
    record: {
      id: id(), profileId: attempt.profileId, scheduleId: attempt.scheduleId,
      profileName: profile ? `${profile.name} ${profile.title}` : '미등록 사용자',
      scheduleLabel: schedule?.label ?? '일정 없음', day, at: attempt.now.toISOString(),
      status: reason ? 'blocked' : 'dispensing', message, boxes,
    },
  };
}

export function recoverInterrupted(data: AppData): AppData {
  return {
    ...data,
    records: data.records.map(r => r.status === 'dispensing'
      ? { ...r, status: 'interrupted', message: '앱이 종료되어 모의 배출 결과를 확인할 수 없습니다. 보호자 확인이 필요합니다.' }
      : r),
  };
}
