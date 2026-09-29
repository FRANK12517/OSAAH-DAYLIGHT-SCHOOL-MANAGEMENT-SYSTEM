import { isConfiguredTestStudentId } from './test-parent-fixture.js';

export const PARENT_UNLINKED_MESSAGE = 'This student is not linked to your registered parent account.';

export async function authorizeParentStudent({ actor, permanentStudentId, students, admissionEnrollment }) {
  if (actor?.portal !== 'parent' || actor?.roleKey !== 'PARENT' || !permanentStudentId) return null;
  const child = (actor.children ?? []).find((item) => item.permanentStudentId === permanentStudentId || item.id === permanentStudentId);
  if (child) {
    const resolvedSample = isConfiguredTestStudentId(permanentStudentId)
      ? students?.listStudents?.({ requestedSchoolId: actor.schoolId, includeTestRecords: true, includeCompleted: true })?.find((item) => item.permanentStudentId === permanentStudentId)
      : null;
    return resolvedSample ?? child;
  }
  if (admissionEnrollment?.authorizeParentStudent) {
    try {
      return await admissionEnrollment.authorizeParentStudent({ parentUserId: actor.id, permanentStudentId, schoolId: actor.schoolId });
    } catch { return null; }
  }
  return students?.findByPermanentStudentId?.(permanentStudentId, { roleKey: actor.roleKey, requestedSchoolId: actor.schoolId })
    && (actor.children ?? []).some((item) => item.id === permanentStudentId || item.permanentStudentId === permanentStudentId)
    ? students.findByPermanentStudentId(permanentStudentId, { roleKey: actor.roleKey, requestedSchoolId: actor.schoolId }) : null;
}
