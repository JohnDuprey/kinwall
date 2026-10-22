// Home upkeep's starter jobs (routes/upkeep.ts GET/POST /api/upkeep/starters): common jobs a family
// can tick to add, each with a usual schedule they can change. Suggestions, never advice: the app
// says to check the manual. `key` marks a job made from one (library_key), so it isn't offered twice.
// Titles are marked with msg() and written in the family's language when added.
import { msg } from './i18n.ts';
import type { RepeatKind, Unit } from './upkeep-rules.ts';

export type UpkeepStarter = {
  key: string; title: string; emoji: string; areaId: string; repeatKind: RepeatKind;
  every?: number; unit?: Unit; onMonths?: number[]; onDay?: number; headsUpDays?: number; supplies?: string[];
};

export const UPKEEP_STARTERS: readonly UpkeepStarter[] = [
  { key: 'hvac-filter', title: msg('Change the furnace or AC filter'), emoji: '🌬️', areaId: 'ua-heating', repeatKind: 'after', every: 3, unit: 'month', supplies: [msg('Furnace filter')] },
  { key: 'hvac-service-fall', title: msg('Service the furnace'), emoji: '🔥', areaId: 'ua-heating', repeatKind: 'on', onMonths: [10], onDay: 1, headsUpDays: 14 },
  { key: 'hvac-service-spring', title: msg('Service the AC'), emoji: '❄️', areaId: 'ua-heating', repeatKind: 'on', onMonths: [4], onDay: 1, headsUpDays: 14 },
  { key: 'smoke-test', title: msg('Test the smoke and CO alarms'), emoji: '🚨', areaId: 'ua-safety', repeatKind: 'after', every: 1, unit: 'month', headsUpDays: 3 },
  { key: 'smoke-batteries', title: msg('Replace the smoke alarm batteries'), emoji: '🔋', areaId: 'ua-safety', repeatKind: 'on', onMonths: [11], onDay: 1, supplies: [msg('9V batteries')] },
  { key: 'extinguisher', title: msg('Check the fire extinguisher'), emoji: '🧯', areaId: 'ua-safety', repeatKind: 'after', every: 1, unit: 'year' },
  { key: 'water-heater', title: msg('Flush the water heater'), emoji: '🚿', areaId: 'ua-water', repeatKind: 'after', every: 1, unit: 'year', headsUpDays: 14 },
  { key: 'sump-pump', title: msg('Test the sump pump'), emoji: '💧', areaId: 'ua-water', repeatKind: 'after', every: 3, unit: 'month' },
  { key: 'fridge-filter', title: msg('Change the fridge water filter'), emoji: '🧊', areaId: 'ua-kitchen', repeatKind: 'after', every: 6, unit: 'month', supplies: [msg('Fridge water filter')] },
  { key: 'fridge-coils', title: msg('Clean the fridge coils'), emoji: '🧹', areaId: 'ua-kitchen', repeatKind: 'after', every: 1, unit: 'year' },
  { key: 'dryer-vent', title: msg('Clean the dryer vent'), emoji: '🌀', areaId: 'ua-kitchen', repeatKind: 'after', every: 1, unit: 'year' },
  { key: 'gutters', title: msg('Clean the gutters'), emoji: '🍂', areaId: 'ua-outside', repeatKind: 'on', onMonths: [4, 10], onDay: 15, headsUpDays: 14 },
  { key: 'oil-change', title: msg('Oil change'), emoji: '🛢️', areaId: 'ua-cars', repeatKind: 'after', every: 6, unit: 'month', headsUpDays: 14 },
  { key: 'tire-rotation', title: msg('Rotate the tires'), emoji: '🛞', areaId: 'ua-cars', repeatKind: 'after', every: 6, unit: 'month', headsUpDays: 14 },
  { key: 'car-registration', title: msg('Renew the car registration'), emoji: '🪪', areaId: 'ua-cars', repeatKind: 'after', every: 1, unit: 'year', headsUpDays: 30 },
];
