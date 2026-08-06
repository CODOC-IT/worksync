export const DEFAULT_BUSINESS_TIME_ZONE = 'Asia/Karachi';

export const formatAttendanceTime = (
  instant: string,
  timeZone = DEFAULT_BUSINESS_TIME_ZONE
): string => {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
};

export const businessDateKey = (
  instant: Date = new Date(),
  timeZone = DEFAULT_BUSINESS_TIME_ZONE
): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

