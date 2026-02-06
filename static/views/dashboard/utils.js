// Re-export shared date/math utilities from the canonical module.
export { addMonthsISO, addYearsISO, addDaysISO, clamp, isoToDayNumber, lowerBound, buildDateAxis } from '../../js/dateutil.js';

export function truncateText(value, max = 36) {
  const s = String(value ?? '');
  if (s.length <= max) return { text: s, title: s };
  const trimmed = s.slice(0, Math.max(0, max - 1)).trimEnd();
  return { text: `${trimmed}…`, title: s };
}

export function asInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export function createEmitter() {
  const listeners = new Map();
  return {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const handler of Array.from(set)) {
        try {
          handler(payload);
        } catch {
          // ignore
        }
      }
    },
  };
}

export const NAME_TRUNCATE = 36;
