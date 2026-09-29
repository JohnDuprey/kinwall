import PickField from './PickField.tsx'
import { timezoneList, tzCity, tzInfo, tzName, tzOrder } from './timezone.ts'

/** The household timezone (Settings → General, setup wizard): this device's zone and the current
 * one first, each row with the local time and UTC offset there; search by city or region. */
export default function TimezoneField({ id, value, onChange }: { id?: string; value: string | null; onChange: (tz: string) => void }) {
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone
  const options = () => {
    const now = new Date()
    return tzOrder(timezoneList(), device, value).map(tz => {
      const { time, offset } = tzInfo(tz, now)
      const region = tz.includes('/') ? tz.slice(0, tz.lastIndexOf('/')) : ''
      return { value: tz, label: tzCity(tz), keywords: tz, detail: [tz === device && 'This device', region, time, tz === 'UTC' ? '' : offset].filter(Boolean).join(' · ') }
    })
  }
  return <PickField id={id} label="Timezone" options={options} value={value ? [value] : []} onChange={v => v[0] && onChange(v[0])}
    search placeholder="City or region, like New York" summary={value ? tzName(value) : 'Not set'} />
}
