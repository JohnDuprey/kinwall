import { Fragment, type ReactNode } from 'react'

/** A translated sentence with React nodes in its {slots}: rich(t('Tap {button} to add'), { button: <b>…</b> }). */
export const rich = (text: string, parts: Record<string, ReactNode>) =>
  text.split(/(\{\w+\})/).map((p, i) => { const k = /^\{(\w+)\}$/.exec(p)?.[1]; return <Fragment key={i}>{k && k in parts ? parts[k] : p}</Fragment> })
