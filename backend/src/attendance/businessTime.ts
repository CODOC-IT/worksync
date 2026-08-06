export const DEFAULT_BUSINESS_TIME_ZONE = 'Asia/Karachi';

export const businessDateSql = (instantSql: string, timeZoneSql: string): string =>
  `(${instantSql} AT TIME ZONE ${timeZoneSql})::date`;

export const localTimestampSql = (dateSql: string, timeSql: string, timeZoneSql: string): string =>
  `((${dateSql})::date + (${timeSql})::time) AT TIME ZONE ${timeZoneSql}`;

