import { WireConfig } from './protocol';

export type DeviceStatus = {
  v: number;
  revision: number;
  rtc: string;
  uno: boolean;
  faceModel: boolean;
  pillModel: boolean;
  uartReady?: boolean;
  inspectionRequired?: boolean;
  autonomy?: boolean;
};

export type DeviceEvent = { seq: number; at: string; kind: string; profileId?: string; scheduleId?: string; box?: number; detail?: string };

export function normalizeBase(input: string): string {
  const text = input.trim().replace(/\/+$/, '');
  if (!/^http:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(text)) throw new Error('기기 주소는 http://192.168.0.20 형식으로 입력해 주세요.');
  return text;
}

async function call<T>(base: string, path: string, init?: RequestInit, timeoutMs = 6000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${normalizeBase(base)}${path}`, { ...init, signal: controller.signal });
    if (!response.ok) {
      const body: unknown = await response.json();
      const detail = typeof body === 'object' && body !== null && 'detail' in body && typeof body.detail === 'string'
        ? ` ${body.detail}` : '';
      throw new Error(`기기가 ${response.status} 오류를 반환했습니다.${detail}`);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('기기 응답이 없습니다. 같은 Wi-Fi인지 확인해 주세요.');
    throw error;
  } finally { clearTimeout(timer); }
}

export const getStatus = (base: string) => call<DeviceStatus>(base, '/api/status');
function authorization(token: string): Record<string, string> {
  if (!token.trim()) throw new Error('로컬 펌웨어 설정의 기기 토큰을 입력해 주세요.');
  return { Authorization: `Bearer ${token.trim()}` };
}

export const getEvents = (base: string, after: number, token: string) =>
  call<{ events: DeviceEvent[] }>(base, `/api/events?after=${after}`, { headers: authorization(token) });

export async function putConfig(base: string, config: WireConfig, token: string): Promise<void> {
  const result = await call<{ ok: boolean; revision: number }>(base, '/api/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...authorization(token) }, body: JSON.stringify(config),
  });
  if (!result.ok || result.revision !== config.revision) throw new Error('기기가 설정 저장을 확인하지 않았습니다.');
}

// A timed-out command is never automatically retried.
export async function testBox(base: string, box: number, token: string): Promise<void> {
  if (!Number.isInteger(box) || box < 1 || box > 4) throw new Error('약통 번호는 1~4만 가능합니다.');
  const result = await call<{ ok: boolean }>(base, `/api/test-open?box=${box}`, {
    method: 'POST', headers: authorization(token),
  }, 15000);
  if (!result.ok) throw new Error('기기가 약통 열기를 거부했습니다.');
}

export async function enroll(base: string, kind: 'face' | 'pill', id: string, token: string): Promise<{ ok: boolean; detail: string }> {
  return call(base, `/api/enroll?kind=${kind}&id=${encodeURIComponent(id)}`, {
    method: 'POST', headers: authorization(token),
  }, 20000);
}
