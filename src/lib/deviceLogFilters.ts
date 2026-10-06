export const messageLogOperators = [
  'contains',
  'does not contain',
  'is',
  'is not',
  'starts with',
  'does not start with',
  'ends with',
  'does not end with',
] as const;

export const timestampLogOperators = ['before', 'after', 'is', 'is not'] as const;

export type LogFilterClause =
  | {
      id: string;
      field: 'message';
      operator: (typeof messageLogOperators)[number];
      value: string;
    }
  | {
      id: string;
      field: 'timestamp';
      operator: (typeof timestampLogOperators)[number];
      value: string;
    };

export interface LogFilterGroup {
  id: string;
  alternatives: LogFilterClause[];
}

const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;
const localTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function validDateParts(parts: RegExpMatchArray): boolean {
  const [, year, month, day, hour, minute, second] = parts;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const daysInMonth = [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    d <= daysInMonth[m - 1]! &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second ?? 0) <= 59
  );
}

/** Filter timestamps must be explicit instants, never ambiguously parsed local dates. */
export function parseLogFilterTimestamp(value: string): number | undefined {
  const parts = value.match(timestampPattern);
  if (!parts || !validDateParts(parts)) return undefined;
  const zone = parts[8]!;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function localLogTimestampToIso(value: string): string | undefined {
  const parts = value.match(localTimestampPattern);
  if (!parts || !validDateParts(parts)) return undefined;
  const [, year, month, day, hour, minute, second, fraction] = parts;
  const date = new Date(0);
  date.setFullYear(Number(year), Number(month) - 1, Number(day));
  date.setHours(Number(hour), Number(minute), Number(second ?? 0), Number((fraction ?? '').padEnd(3, '0')));
  // Date normalizes nonexistent local times during the daylight-saving spring jump.
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute)
  )
    return undefined;
  return date.toISOString();
}

export function validateLogFilterClause(clause: LogFilterClause): string | undefined {
  if (clause.field === 'message') {
    if (!(messageLogOperators as readonly string[]).includes(clause.operator))
      return 'Select a valid message operator.';
    if (!clause.value.length) return 'Enter a message value.';
    return undefined;
  }
  if (clause.field === 'timestamp') {
    if (!(timestampLogOperators as readonly string[]).includes(clause.operator))
      return 'Select a valid timestamp operator.';
    if (parseLogFilterTimestamp(clause.value) === undefined) return 'Enter a valid ISO timestamp with a timezone.';
    return undefined;
  }
  return 'Select a valid field.';
}

export function validateLogFilters(groups: LogFilterGroup[]): string[] {
  return groups.flatMap((group, groupIndex) => {
    if (!group.alternatives.length) return [`Filter ${groupIndex + 1}: add at least one condition.`];
    return group.alternatives.flatMap((clause, clauseIndex) => {
      const error = validateLogFilterClause(clause);
      return error ? [`Filter ${groupIndex + 1}, condition ${clauseIndex + 1}: ${error}`] : [];
    });
  });
}

function matchesClause(entry: { message: string; timestamp: string }, clause: LogFilterClause): boolean {
  if (clause.field === 'timestamp') {
    const actual = Date.parse(entry.timestamp);
    const expected = parseLogFilterTimestamp(clause.value)!;
    if (!Number.isFinite(actual)) return false;
    switch (clause.operator) {
      case 'before':
        return actual < expected;
      case 'after':
        return actual > expected;
      case 'is':
        return actual === expected;
      case 'is not':
        return actual !== expected;
    }
  }
  const actual = entry.message.toLowerCase();
  const expected = clause.value.toLowerCase();
  switch (clause.operator) {
    case 'contains':
      return actual.includes(expected);
    case 'does not contain':
      return !actual.includes(expected);
    case 'is':
      return actual === expected;
    case 'is not':
      return actual !== expected;
    case 'starts with':
      return actual.startsWith(expected);
    case 'does not start with':
      return !actual.startsWith(expected);
    case 'ends with':
      return actual.endsWith(expected);
    case 'does not end with':
      return !actual.endsWith(expected);
  }
}

/** Case-insensitive message search AND groups; each group's alternatives are OR. */
export function matchesLogFilters(
  entry: { message: string; timestamp: string },
  groups: LogFilterGroup[],
  search: string,
): boolean {
  const errors = validateLogFilters(groups);
  if (errors.length) throw new RangeError(errors.join(' '));
  return (
    entry.message.toLowerCase().includes(search.toLowerCase()) &&
    groups.every((group) => group.alternatives.some((clause) => matchesClause(entry, clause)))
  );
}
