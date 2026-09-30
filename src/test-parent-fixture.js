import { normalizeGhanaPhone } from './ghana-phone.js';

export const TEST_PARENT_PHONE = '+233247293733';
export const TEST_PARENT_STUDENT_IDS = Object.freeze(['OSAAH-DEMO-001', 'OSAAH-DEMO-002']);
export const TEST_PARENT_ID = 'user-test-parent-sample';
export const TEST_PARENT_SCHOOL_ID = 'school-osaah-daylight';

export function isConfiguredTestParentPhone(value) {
  return normalizeGhanaPhone(value) === TEST_PARENT_PHONE;
}

export function isConfiguredTestStudentId(value) {
  return TEST_PARENT_STUDENT_IDS.includes(String(value ?? '').trim());
}

export function isConfiguredTestParentActor(actor, schoolId = TEST_PARENT_SCHOOL_ID) {
  return actor?.id === TEST_PARENT_ID
    && actor?.portal === 'parent'
    && actor?.roleKey === 'PARENT'
    && actor?.schoolId === schoolId
    && process.env.OSAAH_ENABLE_SAMPLE_FIXTURES !== 'false';
}

// This server-owned mapping is the complete authorization boundary for the
// controlled test parent. It is intentionally not copied into session data.
export function listConfiguredTestParentRelationships(parentUserId, schoolId = TEST_PARENT_SCHOOL_ID) {
  if (parentUserId !== TEST_PARENT_ID || process.env.OSAAH_ENABLE_SAMPLE_FIXTURES === 'false') return [];
  return TEST_PARENT_STUDENT_IDS.map((permanentStudentId) => ({
    parentUserId: TEST_PARENT_ID,
    schoolId,
    permanentStudentId,
    linkStatus: 'ACTIVE',
    isTestFixture: true
  }));
}

export function createConfiguredTestParent(schoolId = TEST_PARENT_SCHOOL_ID) {
  return {
    id: TEST_PARENT_ID,
    username: 'test-parent.sample@osaah.local',
    phone: TEST_PARENT_PHONE,
    telephone: TEST_PARENT_PHONE,
    portal: 'parent',
    roleKey: 'PARENT',
    schoolId,
    accountStatus: 'ACTIVE',
    is_active: true,
    isTestFixture: true,
    permissions: new Set(['children.read', 'communication.read', 'messages.read', 'messages.write', 'calendar.read', 'library.read', 'transport.read', 'hostel.read', 'discipline.read'])
  };
}
