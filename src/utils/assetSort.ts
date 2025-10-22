import type { AssetRecord } from '../types/assets';

export function sortAssets(records: AssetRecord[]): AssetRecord[] {
  return [...records].sort((a, b) => {
    const date = b.entry_date.localeCompare(a.entry_date);
    if (date !== 0) {
      return date;
    }
    return b.id - a.id;
  });
}
