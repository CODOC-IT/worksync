export const DEFAULT_BUSINESS_TIME_ZONE = 'Asia/Karachi';

export const businessDateSql = (instantSql: string, timeZoneSql: string): string =>
  `(${instantSql} AT TIME ZONE ${timeZoneSql})::date`;

export const localTimestampSql = (dateSql: string, timeSql: string, timeZoneSql: string): string =>
  `((${dateSql})::date + (${timeSql})::time) AT TIME ZONE ${timeZoneSql}`;

// Formats an ISO instant as a wall-clock HH:mm string in the business time zone. This is the
// canonical "clock on the wall" used for attendance display/corrections (PKT by default), so
// breaks and other wall-clock fields are never derived from the browser or the system zone.
export const formatBusinessTime = (
  instant: string | Date,
  timeZone = DEFAULT_BUSINESS_TIME_ZONE
): string => {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
};

