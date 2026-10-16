import Feather from '@expo/vector-icons/Feather';
import { ComponentProps, ReactNode } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

export const colors = {
  navy: '#152E36', muted: '#687E82', teal: '#087F72', mint: '#E6F5EF',
  line: '#DFE8E5', background: '#F5F7F4', white: '#FFFFFF', amber: '#996215',
  danger: '#B54338',
};
export type IconName = ComponentProps<typeof Feather>['name'];
export const Icon = ({ name, size = 20, color = colors.navy }: { name: IconName; size?: number; color?: string }) =>
  <Feather name={name} size={size} color={color} />;
export const Label = ({ children, style }: { children: ReactNode; style?: ComponentProps<typeof Text>['style'] }) =>
  <Text style={[s.label, style]}>{children}</Text>;
export const Muted = ({ children }: { children: ReactNode }) => <Text style={s.muted}>{children}</Text>;
export function Button({ label, onPress, icon, secondary, danger, disabled, small, senior }: {
  label: string; onPress: () => void; icon?: IconName; secondary?: boolean;
  danger?: boolean; disabled?: boolean; small?: boolean; senior?: boolean;
}) {
  const color = danger ? colors.danger : secondary ? colors.navy : colors.white;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.button, secondary && s.secondary, danger && s.dangerButton,
        small && s.smallButton, senior && { minHeight: 72, padding: 18 }, disabled && { opacity: 0.45 }, pressed && { opacity: 0.75 }]}>
      {icon && <Icon name={icon} size={senior ? 32 : small ? 16 : 18} color={color} />}
      <Text style={[s.buttonLabel, senior && { fontSize: 32, lineHeight: 44 }, { color }]}>{label}</Text>
    </Pressable>
  );
}
export function Badge({ label, tone = 'mint' }: { label: string; tone?: 'mint' | 'amber' | 'gray' | 'red' }) {
  const palette = {
    mint: [colors.mint, colors.teal], amber: ['#FFF2D8', colors.amber],
    gray: ['#EDF1EF', '#5B7075'], red: ['#FCEDEA', colors.danger],
  }[tone];
  return <View style={[s.badge, { backgroundColor: palette[0] }]}><Text style={[s.badgeLabel, { color: palette[1] }]}>{label}</Text></View>;
}
export function Card({ children, style }: { children: ReactNode; style?: ComponentProps<typeof View>['style'] }) {
  return <View style={[s.card, style]}>{children}</View>;
}
export function Field({ label, value, onChangeText, placeholder, maxLength = 60, secureTextEntry = false }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; maxLength?: number; secureTextEntry?: boolean;
}) {
  return <View style={s.field}><Label>{label}</Label><TextInput accessibilityLabel={label}
    style={s.input} value={value} onChangeText={onChangeText} placeholder={placeholder}
    placeholderTextColor="#7B898B" maxLength={maxLength} autoCapitalize="none" secureTextEntry={secureTextEntry} /></View>;
}
export function Choice({ label, selected, onPress, disabled }: {
  label: string; selected: boolean; onPress: () => void; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled}
    onPress={onPress} style={[s.choice, selected && s.choiceSelected, disabled && { opacity: 0.45 }]}>
    <Text style={[s.choiceLabel, selected && { color: colors.teal }]}>{label}</Text>
    {selected && <Icon name="check" size={15} color={colors.teal} />}
  </Pressable>;
}
export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <Modal transparent animationType="fade" onRequestClose={onClose}>
    <View style={s.overlay}><View style={s.dialog}>
      <View style={s.between}><Text accessibilityRole="header" style={s.dialogTitle}>{title}</Text>
        <Button label="닫기" secondary small onPress={onClose} icon="x" /></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 20, paddingTop: 24, paddingBottom: 8 }}>
        {children}
      </ScrollView>
    </View></View>
  </Modal>;
}
export function Empty({ title, description }: { title: string; description: string }) {
  return <View style={s.empty}><Icon name="inbox" size={30} color={colors.muted} /><Label>{title}</Label><Muted>{description}</Muted></View>;
}
export const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  label: { color: colors.navy, fontSize: 14, fontWeight: '600', lineHeight: 22 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  button: { minHeight: 46, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12,
    backgroundColor: colors.teal, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  secondary: { backgroundColor: '#F3F6F3', borderWidth: 1, borderColor: colors.line },
  dangerButton: { backgroundColor: '#FCEDEA' },
  smallButton: { minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9 },
  buttonLabel: { fontWeight: '600', fontSize: 13, lineHeight: 20 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },
  badgeLabel: { fontSize: 11, fontWeight: '700', lineHeight: 17 },
  card: { backgroundColor: colors.white, padding: 24, borderRadius: 18, borderWidth: 1, borderColor: colors.line, gap: 18 },
  field: { gap: 8 },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#CEDBD5', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, color: colors.navy, fontSize: 15, backgroundColor: colors.white },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14,
    paddingVertical: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: colors.white },
  choiceSelected: { backgroundColor: colors.mint, borderColor: '#77B8A8' },
  choiceLabel: { fontSize: 14, color: colors.muted, fontWeight: '500' },
  overlay: { flex: 1, backgroundColor: '#102E3699', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 520, maxHeight: '90%', padding: 26, backgroundColor: colors.white, borderRadius: 20 },
  dialogTitle: { fontSize: 22, fontWeight: '700', color: colors.navy },
  empty: { alignItems: 'center', gap: 10, padding: 24 },
});
