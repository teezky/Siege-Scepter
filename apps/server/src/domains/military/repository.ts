import { UNIT_IDS, emptyUnitCounts, type UnitCounts, type UnitId } from '@siege/shared';
import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { cityUnits } from '../../db/schema.js';
import type { Tx } from '../cities/service.js';

type DbOrTx = Database | Tx;

function isUnitId(value: string): value is UnitId {
  return (UNIT_IDS as readonly string[]).includes(value);
}

export async function loadArmy(tx: DbOrTx, cityId: string): Promise<UnitCounts> {
  const result = emptyUnitCounts();
  const rows = await tx
    .select({ unitId: cityUnits.unitId, count: cityUnits.count })
    .from(cityUnits)
    .where(eq(cityUnits.cityId, cityId));
  for (const row of rows) {
    if (isUnitId(row.unitId)) result[row.unitId] = row.count;
  }
  return result;
}

export async function setUnitCount(
  tx: Tx,
  cityId: string,
  unitId: UnitId,
  count: number
): Promise<void> {
  if (count < 0) throw new RangeError('Unit count cannot be negative');
  await tx
    .insert(cityUnits)
    .values({ cityId, unitId, count })
    .onConflictDoUpdate({
      target: [cityUnits.cityId, cityUnits.unitId],
      set: { count }
    });
}
