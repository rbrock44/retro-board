import { Pipe, type PipeTransform } from '@angular/core';

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60],
];

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

@Pipe({ name: 'ago' })
export class RelativeTimePipe implements PipeTransform {
  transform(iso: string | null | undefined): string {
    return relativeTime(iso);
  }
}
