/**
 * Population balancing configuration.
 *
 * Source of truth: game design document, section 11 ("Elanikkonna süsteem").
 * Slice 2 scope: workers + free citizens (taxpayers). Artisans, merchants,
 * scientists and soldiers arrive with their own systems in later slices.
 *
 * Growth is intentionally chunky: one new citizen arrives every
 * `arrivalIntervalMinutes` while there is free housing AND food in storage.
 * Between arrivals every production rate is constant, which keeps the
 * time-based resource model piecewise-linear (project instructions section 9).
 * Famine never kills citizens (design doc 11.2: one bad decision must not
 * empty the city) — it only pauses growth and stops food storage draining
 * below zero.
 */
export const POPULATION = {
  /** Citizens a brand-new city starts with. */
  startingPopulation: 12,
  /** Housing available even without any buildings (tents by the road). */
  baseHousing: 10,
  /** One new citizen arrives this often while housing is free and food > 0. */
  arrivalIntervalMinutes: 15,
  /** Food eaten per citizen per hour. */
  foodPerCitizenPerHour: 2,
  /** Tax income per FREE citizen (not assigned as a worker) per hour. */
  taxCoinsPerFreeCitizenPerHour: 4
} as const;
