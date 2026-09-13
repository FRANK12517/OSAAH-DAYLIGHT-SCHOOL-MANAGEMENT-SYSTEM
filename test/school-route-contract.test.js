import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PROPRIETOR_SIDEBAR_ROUTES, PROPRIETOR_PAGE_ALIASES } from '../src/proprietor-sidebar-routes.js';
test('route contract keeps every Proprietor child canonical and renderable',async()=>{const routes=new Set();for(const item of PROPRIETOR_SIDEBAR_ROUTES){assert.ok(!routes.has(item.route),`duplicate route ${item.route}`);routes.add(item.route);assert.equal(PROPRIETOR_PAGE_ALIASES[item.route],item.page);await readFile(new URL(`../public/${item.page.slice(1)}`,import.meta.url),'utf8');}});
test('critical school routes have isolated targets',()=>{assert.equal(PROPRIETOR_PAGE_ALIASES['/attendance/staff'],'/staff-attendance.html');assert.equal(PROPRIETOR_PAGE_ALIASES['/communication'],'/communication.html');assert.equal(PROPRIETOR_PAGE_ALIASES['/academics/timetable'],'/exam-timetable.html');});
