import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppData, recoverInterrupted, seedData, STORAGE_KEY, validateData } from './domain';

export function useAppData() {
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState('');
  const current = useRef<AppData | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [saving, setSaving] = useState(false);
  const pending = useRef(0);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw === null ? seedData() : JSON.parse(raw);
      validateData(parsed);
      const restored = recoverInterrupted(parsed);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
      current.current = restored;
      setData(restored);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '저장 데이터를 불러올 수 없습니다.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const mutate = useCallback((change: (previous: AppData) => AppData): Promise<AppData> => {
    pending.current += 1;
    setSaving(true);
    const result = queue.current.then(async () => {
      if (!current.current) throw new Error('저장 데이터가 준비되지 않았습니다.');
      const next = change(current.current);
      validateData(next);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      current.current = next;
      setData(next);
      return next;
    });
    // Keep the queue usable after a failed write; callers still receive the rejection.
    queue.current = result.then(() => undefined, () => undefined);
    return result.finally(() => {
      pending.current -= 1;
      setSaving(pending.current > 0);
    });
  }, []);
  return { data, loadError, load, mutate, saving };
}
