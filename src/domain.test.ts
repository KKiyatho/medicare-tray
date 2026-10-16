import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppData, Attempt, decideDispense, localDay, recoverInterrupted, seedData,
  syncDevice, updateConfiguration, validTime, validateData,
} from './domain';

const now = new Date(2026, 9, 16, 8, 0);
const attempt: Attempt = {
  profileId: 'youngsun', scheduleId: 'morning', clockTime: '08:00', medicineMatches: true, now,
};
const ready = () => syncDevice(seedData(), now);

describe('time and configuration validation', () => {
  it('only accepts exact 24-hour HH:MM strings', () => {
    for (const value of ['00:00', '08:00', '23:59']) assert.equal(validTime(value), true);
    for (const value of ['24:00', '8:00', '12:60', '-1:00', '', '08:00:00', '08:00\n', ' 08:00']) assert.equal(validTime(value), false);
  });
  it('validates seed data and synchronized data', () => {
    assert.doesNotThrow(() => validateData(seedData()));
    assert.doesNotThrow(() => validateData(ready()));
  });
  it('rejects unknown versions and malformed stored data', () => {
    for (const value of [null, {}, { version: 2 }, { ...seedData(), profiles: null },
      { ...seedData(), records: [null] }, { ...seedData(), revision: -1 }]) {
      assert.throws(() => validateData(value));
    }
  });
  it('rejects duplicate and out-of-range compartments', () => {
    for (const box of [0, 5, 1.5, 1]) {
      const data = seedData();
      data.medicines[1]!.box = box;
      assert.throws(() => validateData(data));
    }
  });
  it('rejects a schedule referencing another person’s medicine', () => {
    const data = seedData();
    data.schedules[0]!.medicineIds = ['med-c'];
    assert.throws(() => validateData(data));
  });
  it('rejects empty schedules, missing references and duplicate IDs', () => {
    for (const medicineIds of [[], ['missing'], ['med-a', 'med-a']]) {
      const data = seedData();
      data.schedules[0]!.medicineIds = medicineIds;
      assert.throws(() => validateData(data));
    }
    const data = seedData();
    data.profiles[1]!.id = data.profiles[0]!.id;
    assert.throws(() => validateData(data));
  });
  it('rejects remote images and malformed image data', () => {
    const data = seedData();
    data.profiles[0]!.faceUri = 'https://example.com/face.jpg';
    assert.throws(() => validateData(data));
  });
});

describe('fail-closed simulated dispensing', () => {
  it('blocks until a device snapshot has been synchronized', () => {
    const result = decideDispense(seedData(), attempt);
    assert.equal(result.allowed, false);
    assert.deepEqual(result.record.boxes, []);
  });
  it('permits a known person with matching time and medicine', () => {
    const result = decideDispense(ready(), attempt);
    assert.equal(result.allowed, true);
    assert.equal(result.record.status, 'dispensing');
    assert.deepEqual(result.record.boxes, [1]);
    assert.equal(result.record.day, '2026-10-16');
  });
  it('blocks unknown faces and another person’s schedule', () => {
    for (const profileId of ['unknown', 'jungho']) {
      const result = decideDispense(ready(), { ...attempt, profileId });
      assert.equal(result.allowed, false);
      assert.deepEqual(result.record.boxes, []);
    }
  });
  it('rejects early, expired, invalid and boundary times', () => {
    for (const clockTime of ['07:59', '08:30', '23:59', 'bad', '24:00']) {
      assert.equal(decideDispense(ready(), { ...attempt, clockTime }).allowed, false);
    }
    assert.equal(decideDispense(ready(), { ...attempt, clockTime: '08:29' }).allowed, true);
  });
  it('blocks a mismatched medicine before opening any compartment', () => {
    const result = decideDispense(ready(), { ...attempt, medicineMatches: false });
    assert.equal(result.allowed, false);
    assert.deepEqual(result.record.boxes, []);
  });
  it('blocks disabled and missing schedules', () => {
    const data = ready();
    data.device!.schedules[0]!.enabled = false;
    assert.equal(decideDispense(data, attempt).allowed, false);
    assert.equal(decideDispense(data, { ...attempt, scheduleId: 'missing' }).allowed, false);
  });
  for (const status of ['dispensing', 'dispensed', 'interrupted'] as const) {
    it(`blocks same-day repeats after ${status}, including a serialized reload`, () => {
      const data = ready();
      const record = decideDispense(data, attempt).record;
      data.records.push({ ...record, status });
      const reloaded: unknown = JSON.parse(JSON.stringify(data));
      validateData(reloaded);
      assert.equal(decideDispense(reloaded, attempt).allowed, false);
    });
  }
  it('does not consume an attempt blocked by safety checks', () => {
    const data = ready();
    data.records.push(decideDispense(data, { ...attempt, medicineMatches: false }).record);
    assert.equal(decideDispense(data, attempt).allowed, true);
  });
  it('allows the following local calendar day', () => {
    const data = ready();
    data.records.push({ ...decideDispense(data, attempt).record, status: 'dispensed' });
    assert.equal(decideDispense(data, { ...attempt, now: new Date(2026, 9, 17, 8) }).allowed, true);
  });
  it('uses the local calendar date, not the UTC day', () => {
    const date = new Date(2026, 9, 17, 0, 1);
    assert.equal(localDay(date), '2026-10-17');
  });
  it('prepares a sorted unique multi-compartment sequence', () => {
    const data = seedData();
    data.schedules[0]!.medicineIds = ['med-b', 'med-a'];
    const result = decideDispense(syncDevice(data, now), attempt);
    assert.equal(result.allowed, true);
    assert.deepEqual(result.record.boxes, [1, 2]);
  });
  it('recovers unfinished dispensing as a blocking interrupted record', () => {
    const data = ready();
    data.records.push(decideDispense(data, attempt).record);
    const recovered = recoverInterrupted(data);
    assert.equal(recovered.records[0]!.status, 'interrupted');
    assert.equal(decideDispense(recovered, attempt).allowed, false);
    assert.equal(data.records[0]!.status, 'dispensing');
  });
});

describe('offline snapshot behavior', () => {
  it('keeps independent device data until explicit synchronization', () => {
    const data = ready();
    const changed = updateConfiguration(data, {
      schedules: data.schedules.map(sc => sc.id === 'morning' ? { ...sc, time: '10:00' } : sc),
    });
    assert.equal(changed.revision, 2);
    assert.equal(changed.device!.revision, 1);
    assert.equal(decideDispense(changed, attempt).allowed, true);
    const synced = syncDevice(changed, now);
    assert.equal(synced.device!.revision, 2);
    assert.equal(decideDispense(synced, attempt).allowed, false);
    assert.equal(decideDispense(synced, { ...attempt, clockTime: '10:00' }).allowed, true);
  });
  it('preserves device profiles if an app-side profile is deleted', () => {
    const data = ready();
    const changed: AppData = updateConfiguration(data, {
      profiles: data.profiles.filter(p => p.id !== 'youngsun'),
      medicines: data.medicines.filter(m => m.profileId !== 'youngsun'),
      schedules: data.schedules.filter(sc => sc.profileId !== 'youngsun'),
    });
    assert.equal(decideDispense(changed, attempt).allowed, true);
    assert.equal(decideDispense(syncDevice(changed), attempt).allowed, false);
  });
  it('deep-copies arrays instead of sharing snapshot references', () => {
    const data = ready();
    data.schedules[0]!.medicineIds.push('med-b');
    data.profiles[0]!.name = '변경';
    assert.deepEqual(data.device!.schedules[0]!.medicineIds, ['med-a']);
    assert.equal(data.device!.profiles[0]!.name, '김영순');
  });
});
