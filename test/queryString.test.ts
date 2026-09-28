import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'query-string';

test('React Admin list filters can be decoded from the location hash', () => {
  assert.deepEqual(
    { ...parse('filter=%7B%22name%40ilike%22%3A%22test%22%7D&order=ASC&page=1&perPage=10&sort=name') },
    {
      filter: '{"name@ilike":"test"}',
      order: 'ASC',
      page: '1',
      perPage: '10',
      sort: 'name',
    },
  );
});

test('malformed percent encoding remains literal instead of failing or repeatedly decoding', () => {
  assert.deepEqual({ ...parse('filter=%C0%AF%25') }, { filter: '%C0%AF%25' });
});
