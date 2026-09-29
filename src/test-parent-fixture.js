import { normalizeGhanaPhone } from './ghana-phone.js';

export const TEST_PARENT_PHONE = '+233247293733';
export const TEST_PARENT_STUDENT_IDS = Object.freeze(['OSAAH-DEMO-001', 'OSAAH-DEMO-002']);
export const TEST_PARENT_ID = 'user-test-parent-sample';

export function isConfiguredTestParentPhone(value) {
  return normalizeGhanaPhone(value) === TEST_PARENT_PHONE;
}

export function isConfiguredTestStudentId(value) {
  return TEST_PARENT_STUDENT_IDS.includes(String(value ?? '').trim());
}

export function createConfiguredTestParent() {
  return {
    id: TEST_PARENT_ID,
    username: 'test-parent.sample@osaah.local',
    phone: TEST_PARENT_PHONE,
    telephone: TEST_PARENT_PHONE,
    portal: 'parent',
    roleKey: 'PARENT',
    schoolId: 'school-osaah-daylight',
    accountStatus: 'ACTIVE',
    is_active: true,
    isTestFixture: true,
    permissions: new Set(['children.read', 'communication.read', 'messages.read', 'messages.write', 'calendar.read', 'library.read', 'transport.read', 'hostel.read', 'discipline.read']),
    children: TEST_PARENT_STUDENT_IDS.map((permanentStudentId) => ({ permanentStudentId, isTestRecord: true, sampleLabel: 'SAMPLE DATA' }))
  };
}
