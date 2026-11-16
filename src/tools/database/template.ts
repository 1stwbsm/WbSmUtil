import type { WebsimRecord } from '../../core/websim';

/** Top-level platform fields left out of generated templates. */
const METADATA = new Set(['id', '$type', 'user_id', 'username', 'created_at', 'updated_at']);

/**
 * Infer an editable JSON structure from a value, not fabricated data:
 * strings become '', numbers 0, booleans false, arrays keep one element.
 */
export function template(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [template(value[0])] : [];
  if (value === null) return null;
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, template(v)]));
  }
  if (typeof value === 'string') return '';
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  return null;
}

/** Template for a new entry based on a sample record, metadata removed. */
export function entryTemplate(sample: WebsimRecord | undefined): unknown {
  const fields = sample ? Object.fromEntries(Object.entries(sample).filter(([key]) => !METADATA.has(key))) : {};
  return template(fields);
}
