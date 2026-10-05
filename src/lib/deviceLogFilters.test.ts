import assert from 'node:assert/strict';
import test from 'node:test';
import {
  localLogTimestampToIso,
  matchesLogFilters,
  messageLogOperators,
  parseLogFilterTimestamp,
  validateLogFilters,
} from './deviceLogFilters';
import type { LogFilterClause, LogFilterGroup } from './deviceLogFilters';

const entry = { message: 'Hello WORLD', timestamp: '2026-10-05T12:00:00.000Z' };
const group = (...alternatives: LogFilterClause[]): LogFilterGroup => ({ id: 'group', alternatives });
const message = (
  operator: Extract<LogFilterClause, { field: 'message' }>['operator'],
  value: string,
): LogFilterClause => ({
  id: 'message',
  field: 'message',
  operator,
  value,
});
const timestamp = (
  operator: Extract<LogFilterClause, { field: 'timestamp' }>['operator'],
  value: string,
): LogFilterClause => ({
  id: 'timestamp',
  field: 'timestamp',
  operator,
  value,
});

test('empty search and groups match all logs, including missing timestamp content', () => {
  assert.equal(matchesLogFilters(entry, [], ''), true);
  assert.equal(matchesLogFilters({ message: '', timestamp: '' }, [], ''), true);
});

test('every message operator is case-insensitive and matches its exact semantics', () => {
  const cases: Array<[Extract<LogFilterClause, { field: 'message' }>['operator'], string, boolean]> = [
    ['contains', 'LO wo', true],
    ['contains', 'missing', false],
    ['does not contain', 'LO wo', false],
    ['does not contain', 'missing', true],
    ['is', 'HELLO world', true],
    ['is', 'Hello', false],
    ['is not', 'HELLO world', false],
    ['is not', 'Hello', true],
    ['starts with', 'hello ', true],
    ['starts with', 'world', false],
    ['does not start with', 'hello ', false],
    ['does not start with', 'world', true],
    ['ends with', 'WORLD', true],
    ['ends with', 'Hello', false],
    ['does not end with', 'WORLD', false],
    ['does not end with', 'Hello', true],
  ];
  assert.deepEqual([...new Set(cases.map(([operator]) => operator))], [...messageLogOperators]);
  for (const [operator, value, expected] of cases) {
    assert.equal(matchesLogFilters(entry, [group(message(operator, value))], ''), expected, `${operator}: ${value}`);
  }
  assert.equal(matchesLogFilters({ ...entry, message: ' hello ' }, [group(message('is', 'hello'))], ''), false);
  assert.equal(matchesLogFilters(entry, [group(message('contains', '.*'))], ''), false);
});

test('alternatives are OR, separate groups are AND, and search is AND', () => {
  const alternatives = group(message('contains', 'missing'), message('ends with', 'WORLD'));
  const required = { ...group(message('starts with', 'hello')), id: 'required' };
  assert.equal(matchesLogFilters(entry, [alternatives], 'o wo'), true);
  assert.equal(matchesLogFilters(entry, [alternatives, required], 'HELLO'), true);
  assert.equal(matchesLogFilters(entry, [alternatives, required], 'absent'), false);
  assert.equal(matchesLogFilters(entry, [alternatives, group(message('is', 'no'))], ''), false);
  assert.equal(matchesLogFilters(entry, [group(message('is', 'no'), message('contains', 'absent'))], ''), false);
  assert.equal(matchesLogFilters(entry, [], ' WORLD'), true);
  assert.equal(matchesLogFilters(entry, [], ' HELLO'), false);
});

test('timestamp operators compare instants, not strings or local dates', () => {
  const cases: Array<[Extract<LogFilterClause, { field: 'timestamp' }>['operator'], string, boolean]> = [
    ['before', '2026-10-05T12:00:00.001Z', true],
    ['before', entry.timestamp, false],
    ['before', '2026-10-05T11:59:59.999Z', false],
    ['after', '2026-10-05T11:59:59.999Z', true],
    ['after', entry.timestamp, false],
    ['after', '2026-10-05T12:00:00.001Z', false],
    ['is', '2026-10-05T14:00:00+02:00', true],
    ['is', '2026-10-05T12:00:00.001Z', false],
    ['is not', '2026-10-05T14:00:00+02:00', false],
    ['is not', '2026-10-05T12:00:00.001Z', true],
  ];
  for (const [operator, value, expected] of cases) {
    assert.equal(matchesLogFilters(entry, [group(timestamp(operator, value))], ''), expected, `${operator}: ${value}`);
  }
  assert.equal(
    matchesLogFilters({ ...entry, timestamp: 'invalid' }, [group(timestamp('is not', entry.timestamp))], ''),
    false,
  );
  assert.equal(
    matchesLogFilters(
      { ...entry, timestamp: 'invalid' },
      [group(timestamp('is', entry.timestamp), message('contains', 'world'))],
      '',
    ),
    true,
  );
});

test('ISO timestamp validation rejects ambiguous dates, rollover, invalid clocks and timezone offsets', () => {
  for (const value of [
    '',
    'yesterday',
    '2026-10-05',
    '2026-10-05T12:00',
    '10/05/2026',
    '2026-02-29T12:00:00Z',
    '2026-04-31T12:00:00Z',
    '2026-00-05T12:00:00Z',
    '2026-13-05T12:00:00Z',
    '2026-10-00T12:00:00Z',
    '2026-10-05T24:00:00Z',
    '2026-10-05T12:60:00Z',
    '2026-10-05T12:00:60Z',
    '2026-10-05T12:00:00+24:00',
    '2026-10-05T12:00:00+01:60',
    '2026-10-05T12:00:00Z extra',
    ' 2026-10-05T12:00:00Z',
  ]) {
    assert.equal(parseLogFilterTimestamp(value), undefined, value);
  }
  assert.equal(parseLogFilterTimestamp('2024-02-29T12:00:00Z'), Date.parse('2024-02-29T12:00:00Z'));
  assert.equal(parseLogFilterTimestamp('2026-10-05T12:00Z'), Date.parse('2026-10-05T12:00Z'));
  assert.equal(parseLogFilterTimestamp('1900-02-29T12:00:00Z'), undefined);
  assert.equal(parseLogFilterTimestamp('2000-02-29T12:00:00Z'), Date.parse('2000-02-29T12:00:00Z'));
});

test('local datetime input converts to timezone-qualified ISO without losing milliseconds', () => {
  const local = '2026-10-05T12:34:56.789';
  const iso = localLogTimestampToIso(local);
  assert.equal(iso, new Date(2026, 9, 5, 12, 34, 56, 789).toISOString());
  assert.equal(parseLogFilterTimestamp(iso!), Date.parse(iso!));
  assert.equal(localLogTimestampToIso('2026-10-05T12:34'), new Date(2026, 9, 5, 12, 34).toISOString());
  for (const value of ['', '2026-02-29T12:00', '2026-10-05', '2026-10-05T24:00', '2026-10-05T12:00Z']) {
    assert.equal(localLogTimestampToIso(value), undefined, value);
  }
});

test('invalid filters expose errors and cannot silently change matching, even in an unused OR branch', () => {
  const invalidGroups = [
    group(),
    group(message('contains', '')),
    group(timestamp('after', 'invalid')),
    group(message('contains', 'world'), timestamp('before', 'invalid')),
    group({ id: 'bad', field: 'message', operator: 'unknown', value: 'world' } as unknown as LogFilterClause),
    group({
      id: 'bad',
      field: 'timestamp',
      operator: 'contains',
      value: entry.timestamp,
    } as unknown as LogFilterClause),
    group({ id: 'bad', field: 'unknown', operator: 'is', value: 'world' } as unknown as LogFilterClause),
  ];
  for (const filters of invalidGroups) {
    assert.ok(validateLogFilters([filters]).length > 0);
    assert.throws(() => matchesLogFilters(entry, [filters], ''), RangeError);
    assert.throws(() => matchesLogFilters(entry, [filters], 'no match'), RangeError);
  }
  assert.deepEqual(validateLogFilters([]), []);
  assert.deepEqual(validateLogFilters([group(message('contains', ' '), timestamp('after', entry.timestamp))]), []);
});
