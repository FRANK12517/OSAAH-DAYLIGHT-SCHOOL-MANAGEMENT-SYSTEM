import { isConfiguredTestParentActor, listConfiguredTestParentRelationships } from './test-parent-fixture.js';

export const PARENT_UNLINKED_MESSAGE = 'This student is not linked to your registered parent account.';

export async function authorizeParentStudent({ actor, permanentStudentId, students, admissionEnrollment }) {
  if (actor?.portal !== 'parent' || actor?.roleKey !== 'PARENT' || !actor?.id || !actor?.schoolId || !permanentStudentId) return null;
  const requestedId = String(permanentStudentId).trim();

  // The only sample relationship is the server-owned controlled test fixture.
  // Resolve it to an actual isolated sample record; never authorize by phone or
  // by any child list that happened to be serialized into a session.
  if (isConfiguredTestParentActor(actor)) {
    const relationship = listConfiguredTestParentRelationships(actor.id)
      .find((item) => item.schoolId === actor.schoolId && item.permanentStudentId === requestedId && item.linkStatus === 'ACTIVE');
    if (!relationship) return null;
    return students?.listStudents?.({ requestedSchoolId: actor.schoolId, includeTestRecords: true, includeCompleted: true })
      ?.find((item) => item.permanentStudentId === requestedId && item.isTestRecord === true && item.schoolId === actor.schoolId) ?? null;
  }

  // In production this re-reads the active canonical parent/student link on
  // every request, so a stale signed-in session cannot preserve revoked access.
  if (admissionEnrollment?.authorizeParentStudent) {
    try {
      return await admissionEnrollment.authorizeParentStudent({
        parentUserId: actor.id,
        permanentStudentId: requestedId,
        schoolId: actor.schoolId
      }) ?? null;
    } catch {
      return null;
    }
  }

  // Non-database/demo mode can use the student service's server-side parent
  // links, but never actor.children or another browser/session-provided list.
  const candidates = students?.listStudents?.({ requestedSchoolId: actor.schoolId, includeCompleted: true }) ?? [];
  for (const student of candidates) {
    if (student.isTestRecord || student.permanentStudentId !== requestedId || student.schoolId !== actor.schoolId) continue;
    const links = students?.parentLinksFor?.(student.id, actor.schoolId) ?? [];
    if (links.some((link) => link.parentId === actor.id)) return student;
  }
  return null;
}
