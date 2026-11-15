import assert from 'node:assert/strict';
import test from 'node:test';
import { createDurableStudentProfileService } from '../src/durable-student-profile.js';

const student = {
  id: 'student-1', school_id: 'sch_default_01', permanent_student_id: 'OSAA/2026/001',
  first_name: 'Ama', middle_name: null, last_name: 'Mensah', student_status: 'ACTIVE'
};
const profile = {
  id: 'profile-1', school_id: 'sch_default_01', student_master_id: 'student-1',
  previous_school: 'Bogoso Basic School', previous_class: 'Basic 2'
};

function service() {
  const database = {
    async query(sql) {
      if (sql.includes('SELECT * FROM students')) return [student];
      if (sql.includes('SELECT * FROM student_profiles')) return [profile];
      if (sql.includes('student_family_contacts')) return [];
      if (sql.includes('profile_previous_school')) return [{
        ...student,
        profile_id: 'profile-1', profile_first_name: 'Ama', profile_last_name: 'Mensah', profile_class_id: 'class-1',
        profile_previous_school: 'Bogoso Basic School', profile_previous_class: 'Basic 2'
      }];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute() { return {}; }
  };
  return createDurableStudentProfileService({ database });
}

test('student profile GET preserves previous transfer school and class', async () => {
  const result = await service().getStudent('student-1', { schoolId: 'sch_default_01' });
  assert.equal(result.previousSchool, 'Bogoso Basic School');
  assert.equal(result.previousClass, 'Basic 2');
});

test('student profile search returns previous transfer school and class', async () => {
  const result = await service().search('Ama', { schoolId: 'sch_default_01' });
  assert.equal(result[0].previousSchool, 'Bogoso Basic School');
  assert.equal(result[0].previousClass, 'Basic 2');
});
