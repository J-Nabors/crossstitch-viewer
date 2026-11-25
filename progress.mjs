const legacyPrefix = 'stitch-focus.progress.';
const storageKey = 'stitch-focus.progress-v1';
const patternId = /^(?:demo-greenhouse-v1|[0-9a-f]{64}(?:\.\d+(?:\.\d+){6})?)$/;
const invalidCode = 'Enter a valid Stitch Focus progress code.';

function isThreadList(threads) {
  return Array.isArray(threads) && threads.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128);
}

function readRecords(records) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) throw new Error(invalidCode);
  const entries = Object.entries(records);
  if (entries.some(([id, threads]) => !patternId.test(id) || !isThreadList(threads))) throw new Error(invalidCode);
  return new Map(entries.map(([id, threads]) => [id, new Set(threads)]));
}

function serialize(records) {
  return JSON.stringify(Object.fromEntries([...records].sort(([a], [b]) => a.localeCompare(b))
    .map(([id, threads]) => [id, [...threads].sort()])));
}

export function readProgress(storage) {
  const saved = storage.getItem(storageKey);
  if (saved !== null) return readRecords(JSON.parse(saved));
  const legacy = new Map();
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(legacyPrefix)) continue;
    const id = key.slice(legacyPrefix.length);
    if (!patternId.test(id)) continue;
    try {
      const threads = JSON.parse(storage.getItem(key));
      if (isThreadList(threads)) legacy.set(id, new Set(threads));
    } catch {
      // A damaged legacy entry should not hide the rest of the saved patterns.
    }
  }
  return legacy;
}

export function writeProgress(storage, records) {
  storage.setItem(storageKey, serialize(records));
}

export function encodeProgress(records) {
  const bytes = new TextEncoder().encode(serialize(records));
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return 'SF1.' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeProgress(code) {
  const match = code.replace(/\s/g, '').match(/^SF1\.([A-Za-z0-9_-]+)$/);
  if (!match) throw new Error(invalidCode);
  try {
    const binary = atob(match[1].replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return readRecords(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    throw new Error(invalidCode);
  }
}

export function mergeProgress(current, imported, replace) {
  const records = new Map(current);
  for (const [id, threads] of imported) {
    records.set(id, replace ? threads : new Set([...(records.get(id) || []), ...threads]));
  }
  return records;
}
