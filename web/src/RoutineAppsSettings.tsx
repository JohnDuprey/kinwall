import { useEffect, useState } from 'react'
import { api, MOCK } from './api.ts'
import { appPlatform, appRoutineSelection } from './native.ts'
import { t, tn } from './i18n.ts'
import { routineDeviceError } from './routineDeviceError.ts'
import { routineDeviceDelivery, type RoutineDevices, type RoutineNativeStatus } from './routineDevices.ts'
import type { RoutineState } from './routineMode.ts'

/** Settings sees counts and delivery reports. Apple selections travel only through native code. */
export default function RoutineAppsSettings({ memberId, childName, state, native, busy, pending, post }: { memberId: string; childName: string; state: RoutineState; native: RoutineNativeStatus | null; busy: boolean; pending: boolean; post(action: string, payload?: unknown): void }) {
  const [loaded, setLoaded] = useState<{ memberId: string; value: RoutineDevices; checkedAt: number } | null>(null)
  const [failed, setFailed] = useState(false), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    const load = async () => {
      try { const value = await api.getRoutineDevices(memberId); if (active) { setLoaded({ memberId, value, checkedAt: Date.now() }); setFailed(false) } }
      catch { if (active) setFailed(true) }
    }
    load(); const timer = setInterval(load, 15000)
    return () => { active = false; clearInterval(timer) }
  }, [memberId, native?.revision, refresh])
  const devices = loaded?.memberId === memberId ? loaded.value : null
  const selection = devices?.selection
  return <section id="routine-apps" className="routine-card">
    <h3 className="routine-child-settings-title">{t('Apps for {name}', { name: childName })}</h3>
    <p>{t('First pair Kinwall on your child’s iPhone or iPad and approve Screen Time there. Then choose apps from your own iPhone or iPad in the same Apple Family Sharing group.')}</p>
    <p className="settings-row-sub">{t('Apple may show apps from more than one authorized child. Your choices here are sent only to {name}. Changes to the app mode above save automatically.', { name: childName })}</p>
    {pending && <p>{t('Finish the routine settings above and wait for Saved before choosing apps.')}</p>}
    {appRoutineSelection() ? <button type="button" className="btn btn-secondary" disabled={busy || pending} onClick={() => post('chooseApps', state)}>{busy ? t('Please wait…') : t('Choose apps for {name}', { name: childName })}</button>
      : <p>{appPlatform() === 'ios' ? t('Update Kinwall to choose apps from your phone.') : t('Open these settings in Kinwall on your iPhone or iPad to choose apps.')}</p>}
    {native?.simulator && <p className="chip-static">{t('Simulator preview — apps are not blocked')}</p>}
    {native?.selectionSaved && <p role="status">{native.simulator ? t('Sample app choices saved for this child in the simulator.') : t('App choices saved. Open Kinwall on the child’s device to receive them.')}</p>}
    {native?.error && <p role="alert">{routineDeviceError(native.error, 'parent')}</p>}
    {selection && <>
      <p>{tn(selection.selectedApps + selection.selectedCategories, 'One app or category selected', '{n} apps or categories selected')}</p>
      <p>{tn(selection.allowedApps, 'One app kept available', '{n} apps kept available')}</p>
    </>}
    {failed && <p role="alert">{t('Could not check the child’s devices. Try again.')}</p>}
    {devices && !devices.devices.length && <p>{MOCK ? t('The demo does not connect to a real child device.') : t('No child device has checked in yet. Open Settings → Family in Kinwall on the child’s paired device to finish Screen Time setup.')}</p>}
    {devices && devices.devices.length > 0 && <ul className="routine-list">{devices.devices.map(device => {
      const delivery = routineDeviceDelivery(device, selection?.revision ?? 0, loaded?.checkedAt ?? 0, state.enabled && state.appMode !== 'all')
      return <li key={device.id}><span>{device.name}</span><span>{delivery === 'authorization' ? t('Screen Time approval needed') : delivery === 'authorized' ? t('Screen Time is approved on this device.') : delivery === 'choices' ? t('Waiting for app choices') : delivery === 'pending' ? t('Waiting for the latest app choices') : delivery === 'offline' ? t('Open Kinwall to check again') : t('Latest app choices received')}</span></li>
    })}</ul>}
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setRefresh(value => value + 1); post('sync', state) }}>{t('Check device status')}</button>
    <p className="settings-row-sub">{t('Device status is its last report. Changes take effect after the child’s device connects. Keep Kinwall and essential apps available; choose Safari under Keep available when using allowed websites.')}</p>
  </section>
}
