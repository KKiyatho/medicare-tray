import { Configuration, DeviceSnapshot } from './domain';

export const PROTOCOL_VERSION = 1;

// Photos stay on the phone; the Cam only receives compact text fields.
export type WireConfig = {
  v: number;
  revision: number;
  profiles: { id: string; name: string; title: string }[];
  medicines: { id: string; profileId: string; name: string; box: number }[];
  schedules: { id: string; profileId: string; label: string; time: string; medicineIds: string[]; enabled: boolean }[];
};

export function toWireConfig(config: Configuration, revision: number): WireConfig {
  return {
    v: PROTOCOL_VERSION,
    revision,
    profiles: config.profiles.map(p => ({ id: p.id, name: p.name, title: p.title })),
    medicines: config.medicines.map(m => ({ id: m.id, profileId: m.profileId, name: m.name, box: m.box })),
    schedules: config.schedules.map(s => ({
      id: s.id, profileId: s.profileId, label: s.label, time: s.time, medicineIds: [...s.medicineIds], enabled: s.enabled,
    })),
  };
}

export const snapshotToWire = (snapshot: DeviceSnapshot) => toWireConfig(snapshot, snapshot.revision);
