// Static Pakistan public holiday data for read-only Calendar entries, plus a few additional
// major holidays (Diwali, Holi) observed by communities in the region even where they aren't a
// gazetted public holiday. Fixed-date holidays (Gregorian, same day every year) are computed for
// any year on request. Islamic (Hijri) and Hindu (lunisolar) calendar holidays shift each
// Gregorian year and are only knowable in advance via the officially-published civil calendar /
// panchang, so they're looked up from a per-year table covering a reasonable navigation window
// around "now" -- extend LUNAR_HOLIDAYS with more years as official/estimated dates become
// available. Years outside that table simply show no lunar holiday; fixed-date holidays are
// unaffected.

export interface PakistanHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

const pad2 = (value: number): string => value.toString().padStart(2, '0');

interface FixedHoliday {
  month: number; // 1-12
  day: number;
  name: string;
}

const FIXED_HOLIDAYS: FixedHoliday[] = [
  { month: 2, day: 5, name: 'Kashmir Day' },
  { month: 3, day: 23, name: 'Pakistan Day' },
  { month: 5, day: 1, name: 'Labour Day' },
  { month: 8, day: 14, name: 'Independence Day' },
  { month: 12, day: 25, name: 'Quaid-e-Azam Day' },
  { month: 12, day: 25, name: 'Christmas Day' }
];

interface LunarHoliday {
  name: string;
  date: string; // YYYY-MM-DD
}

// Published/estimated Gregorian dates; the actual date for the Islamic (moon-sighting) and
// Hindu (panchang) occasions is confirmed close to each occasion and may shift by a day.
const LUNAR_HOLIDAYS: Record<number, LunarHoliday[]> = {
  2024: [
    { name: 'Eid-ul-Fitr', date: '2024-04-10' },
    { name: 'Eid-ul-Adha', date: '2024-06-17' },
    { name: 'Ashura', date: '2024-07-17' },
    { name: 'Holi', date: '2024-03-25' },
    { name: 'Diwali', date: '2024-11-01' }
  ],
  2025: [
    { name: 'Eid-ul-Fitr', date: '2025-03-31' },
    { name: 'Eid-ul-Adha', date: '2025-06-07' },
    { name: 'Ashura', date: '2025-07-06' },
    { name: 'Holi', date: '2025-03-14' },
    { name: 'Diwali', date: '2025-10-20' }
  ],
  2026: [
    { name: 'Eid-ul-Fitr', date: '2026-03-20' },
    { name: 'Eid-ul-Adha', date: '2026-05-27' },
    { name: 'Ashura', date: '2026-06-26' },
    { name: 'Holi', date: '2026-03-03' },
    { name: 'Diwali', date: '2026-11-08' }
  ],
  2027: [
    { name: 'Eid-ul-Fitr', date: '2027-03-10' },
    { name: 'Eid-ul-Adha', date: '2027-05-17' },
    { name: 'Ashura', date: '2027-06-16' },
    { name: 'Holi', date: '2027-03-22' },
    { name: 'Diwali', date: '2027-10-29' }
  ],
  2028: [
    { name: 'Eid-ul-Fitr', date: '2028-02-27' },
    { name: 'Eid-ul-Adha', date: '2028-05-05' },
    { name: 'Ashura', date: '2028-06-04' },
    { name: 'Holi', date: '2028-03-11' },
    { name: 'Diwali', date: '2028-10-17' }
  ],
  2029: [
    { name: 'Eid-ul-Fitr', date: '2029-02-15' },
    { name: 'Eid-ul-Adha', date: '2029-04-24' },
    { name: 'Ashura', date: '2029-05-24' },
    { name: 'Holi', date: '2029-02-28' },
    { name: 'Diwali', date: '2029-11-05' }
  ]
};

export const getPakistanHolidays = (year: number): PakistanHoliday[] => {
  const fixed = FIXED_HOLIDAYS.map((holiday) => ({
    date: `${year}-${pad2(holiday.month)}-${pad2(holiday.day)}`,
    name: holiday.name
  }));
  return [...fixed, ...(LUNAR_HOLIDAYS[year] || [])];
};
