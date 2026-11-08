import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleFixturesEnabled, seedSampleStudentsIfEnabled } from '../src/test-parent-fixture.js';
import { PRODUCTION_SAFE_ACADEMIC_SAMPLE_ENDPOINTS } from '../src/academic-sample-mode.js';

test('production academic sample allowlist includes only isolated sample lifecycle routes', () => {
  for (const route of [
    '/api/academic/sample/generate',
    '/api/academic/sample/mock-generate',
    '/api/academic/sample/result/pdf',
    '/api/academic/sample/publish',
    '/api/academic/sample/state',
    '/api/academic/sample/reset',
    '/api/academic/sample/mock-reset'
  ]) assert.ok(PRODUCTION_SAFE_ACADEMIC_SAMPLE_ENDPOINTS.has(route), `${route} should support the isolated production sample workflow`);
  assert.ok(!PRODUCTION_SAFE_ACADEMIC_SAMPLE_ENDPOINTS.has('/api/academic/sample/unknown'));
});

test('sample fixtures remain available outside production unless explicitly disabled', () => {
  assert.equal(sampleFixturesEnabled({}), true);
  assert.equal(sampleFixturesEnabled({ NODE_ENV: 'test' }), true);
  assert.equal(sampleFixturesEnabled({ OSAAH_ENABLE_SAMPLE_FIXTURES: 'false' }), false);
});

test('sample fixtures cannot be enabled in a production runtime by a stale environment flag', () => {
  assert.equal(sampleFixturesEnabled({ NODE_ENV: 'production', OSAAH_ENABLE_SAMPLE_FIXTURES: 'true' }), false);
  assert.equal(sampleFixturesEnabled({ VERCEL_ENV: 'production', OSAAH_ENABLE_SAMPLE_FIXTURES: 'true' }), false);
});

test('startup fixture seeding is skipped in production even when enabled by a stale flag', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFlag = process.env.OSAAH_ENABLE_SAMPLE_FIXTURES;
  process.env.NODE_ENV = 'production';
  process.env.OSAAH_ENABLE_SAMPLE_FIXTURES = 'true';
  try {
    let seeds = 0;
    const students = {
      listStudents() { return []; },
      seedSampleStudents() { seeds += 1; }
    };
    assert.equal(seedSampleStudentsIfEnabled(students, 'sch_default_01'), false);
    assert.equal(seeds, 0);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousFlag === undefined) delete process.env.OSAAH_ENABLE_SAMPLE_FIXTURES;
    else process.env.OSAAH_ENABLE_SAMPLE_FIXTURES = previousFlag;
  }
});
