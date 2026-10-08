// A refill place's phone menu as steps (routes/medication-refills.ts): wait some seconds, press keys,
// or wait for the caller. The dial string after the number ("," = a 2-second pause, ";" = the phone
// asks before going on) and the written steps both come from them. The web app has the same code
// (web/src/dialSteps.ts, with its test); change both together.
export type DialStep = ({ kind: 'wait'; seconds: number } | { kind: 'press'; digits: string } | { kind: 'confirm' }) & { label?: string };

/** ",,2,1;": each wait is its seconds in 2-second commas (rounded up), a press its keys, "wait for me" a ";". */
export const stepsToDial = (steps: DialStep[]): string =>
  steps.map((s) => (s.kind === 'wait' ? ','.repeat(Math.max(1, Math.ceil(s.seconds / 2))) : s.kind === 'press' ? s.digits : ';')).join('');

/** "Wait 4 seconds, press 2 (Prescriptions), then press 1 (Refill line)." ('' with no steps). */
export function stepsToWords(steps: DialStep[]): string {
  const parts = steps.map((s) => {
    const what = s.kind === 'wait' ? `wait ${s.seconds} second${s.seconds === 1 ? '' : 's'}` : s.kind === 'press' ? `press ${s.digits}` : 'wait until you are ready to go on';
    return s.label?.trim() ? `${what} (${s.label.trim()})` : what;
  });
  if (!parts.length) return '';
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, then ${parts.at(-1)}` : parts[0];
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

/** A dial string back into steps: a run of commas is a wait (2 seconds each), ";" waits for the caller, keys are a press. */
export function dialToSteps(dial: string): DialStep[] {
  const steps: DialStep[] = [];
  for (const run of dial.replace(/[^0-9*#,;]/g, '').match(/,+|;|[0-9*#]+/g) ?? []) {
    steps.push(run.startsWith(',') ? { kind: 'wait', seconds: run.length * 2 } : run === ';' ? { kind: 'confirm' } : { kind: 'press', digits: run });
  }
  return steps;
}
