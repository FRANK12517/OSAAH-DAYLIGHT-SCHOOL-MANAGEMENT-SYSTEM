import { parentDashboardModules } from './sidebar-registry.js';
import { isConfiguredTestParentActor, listConfiguredTestParentRelationships, isConfiguredTestStudentId, TEST_PARENT_SCHOOL_ID } from './test-parent-fixture.js';
import { authorizeParentStudent } from './parent-authorization.js';
import { isConfiguredSampleAcademicContext, listConfiguredSampleAcademicContexts } from './sample-academic-context.js';
import { STUDENT_STATUSES } from './attendance.js';
import { attendancePercentage, attendancePercentageDenominator } from './attendance-aggregation.js';
import { CANONICAL_CLASS_IDS, canonicalClassId, displayClassName } from './student-classes.js';

const text = (value) => String(value ?? '').trim();
const rows = (value) => Array.isArray(value) ? value : [];
const TERMINAL_PAYMENT_STATUSES = new Set(['VALID', 'PAID', 'COMPLETED', 'POSTED']);
const COMPONENTS = Object.freeze([
  { moduleKey: 'parent-attendance', recordType: 'attendance', scope: 'student', requiresAcademicContext: true },
  { moduleKey: 'parent-results', recordType: 'published-results', scope: 'student', requiresAcademicContext: true },
  { moduleKey: 'parent-fees', recordType: 'fees', scope: 'student', requiresAcademicContext: true },
  { moduleKey: 'parent-payments', recordType: 'payments', scope: 'student', requiresAcademicContext: true },
  { moduleKey: 'parent-timetable', recordType: 'timetable', scope: 'student', requiresAcademicContext: true },
  { moduleKey: 'parent-homework', recordType: 'homework', scope: 'student', requiresAcademicContext: true },
  { moduleKey: 'parent-assignments', recordType: 'assignments', scope: 'student', requiresAcademicContext: true },
  { moduleKey: 'parent-announcements', recordType: null, scope: 'parent-and-child' },
  { moduleKey: 'parent-calendar', recordType: null, scope: 'parent-and-child' },
  { moduleKey: 'parent-messages', recordType: null, scope: 'parent-and-child' },
  { moduleKey: 'parent-transport', recordType: 'transport', scope: 'student', requiresAcademicContext: false },
  { moduleKey: 'parent-documents', recordType: 'documents', scope: 'student', requiresAcademicContext: false }
]);
const UNSUPPORTED_RECORD_TYPES = Object.freeze([
  { id: 'homework', name: 'Homework', message: 'Homework records are not available yet.' },
  { id: 'assignments', name: 'Assignments', message: 'Assignment records are not available yet.' },
  { id: 'documents', name: 'Documents', message: 'Parent-safe student document access is not available yet.' }
]);

function fail(message, status = 400, code = 'PARENT_DASHBOARD_ERROR') {
  throw Object.assign(new Error(message), { status, code });
}
function parentActor(actor) {
  if (!actor?.id || !actor?.schoolId || actor.portal !== 'parent' || actor.roleKey !== 'PARENT' || !actor.permissions?.has?.('children.read')) {
    fail('Forbidden.', 403, 'PARENT_ACCESS_REQUIRED');
  }
  return actor;
}
function classOption(item) {
  if (typeof item === 'string') return { id: item, name: item.replace(/^KG([12])$/, 'KG $1') };
  const id = text(item?.id ?? item?.classId ?? item?.name);
  const sourceName = text(item?.name ?? item?.className ?? id);
  const canonical = canonicalClassId(sourceName) ?? canonicalClassId(id);
  const name = canonical ? displayClassName(canonical) : sourceName.replace(/^KG([12])$/, 'KG $1');
  return id ? { id, name, ...(item?.contextOnly ? { contextOnly: true } : {}) } : null;
}
function canonicalClassOptions(items) {
  const configured = new Map();
  const additional = [];
  for (const raw of rows(items)) {
    const option = classOption(raw);
    if (!option) continue;
    const canonical = canonicalClassId(option.name) ?? canonicalClassId(option.id);
    if (canonical) {
      if (!configured.has(canonical)) configured.set(canonical, { ...option, name: displayClassName(canonical) });
    } else if (!additional.some((item) => item.id === option.id)) additional.push(option);
  }
  return [
    ...CANONICAL_CLASS_IDS.map((id) => configured.get(id) ?? { id, name: displayClassName(id) }),
    ...additional
  ];
}
function academicYearOption(item) {
  const id = text(item?.id ?? item?.name);
  const name = text(item?.name ?? item?.id);
  return id && name ? { id, name, ...(item?.isCurrent !== undefined ? { isCurrent: Boolean(item.isCurrent) } : {}) } : null;
}
function termOption(item) {
  const displayTerm = (value) => text(value).replace(/^First Term$/i, '1st Term').replace(/^Second Term$/i, '2nd Term').replace(/^Third Term$/i, '3rd Term');
  if (typeof item === 'string') return { id: item, name: displayTerm(item), canonicalName: item };
  const id = text(item?.id ?? item?.name);
  const canonicalName = text(item?.name ?? item?.id);
  const name = displayTerm(canonicalName);
  return id && name ? { id, name, canonicalName, ...(item?.academicYearId ? { academicYearId: String(item.academicYearId) } : {}), ...(item?.isCurrent !== undefined ? { isCurrent: Boolean(item.isCurrent) } : {}) } : null;
}
function studentName(student) {
  return text(student?.name) || [student?.firstName, student?.middleName, student?.surname ?? student?.lastName].map(text).filter(Boolean).join(' ');
}
function childSummary(student) {
  const permanentStudentId = text(student?.permanentStudentId ?? student?.permanent_student_id);
  const isTestRecord = Boolean(student?.isTestRecord ?? student?.is_test_record);
  const gender = student?.gender ?? null;
  const studentStatus = student?.studentStatus ?? student?.student_status ?? student?.status ?? null;
  const enrollmentStatus = student?.enrollmentStatus ?? student?.enrollment_status ?? student?.profileEnrollmentStatus ?? student?.profile_enrollment_status ?? null;
  const classId = student?.classId ?? student?.class_id ?? student?.currentClassId ?? null;
  const rawClassName = student?.className ?? student?.class_name ?? classId ?? null;
  const canonicalClass = canonicalClassId(rawClassName) ?? canonicalClassId(classId);
  return {
    permanentStudentId,
    name: studentName(student) || 'Authorized student',
    classId,
    className: canonicalClass ? displayClassName(canonicalClass) : rawClassName,
    ...(gender !== null && gender !== undefined ? { gender } : {}),
    ...(studentStatus !== null && studentStatus !== undefined ? { studentStatus } : {}),
    ...(enrollmentStatus !== null && enrollmentStatus !== undefined ? { enrollmentStatus } : {}),
    isTestRecord,
    sampleLabel: isTestRecord ? 'SAMPLE DATA' : null
  };
}
function authorizedIds(student) {
  return [...new Set([student?.id, student?.studentId, student?.student_id, student?.studentProfileId, student?.student_profile_id, student?.permanentStudentId]
    .map(text).filter(Boolean))];
}
function normalizeTermName(value) {
  return text(value).toLowerCase().replace(/^(first|1st)\s+term$/, '1st Term').replace(/^(second|2nd)\s+term$/, '2nd Term').replace(/^(third|3rd)\s+term$/, '3rd Term').toLowerCase();
}

function attendanceSummary(records) {
  const counts = Object.fromEntries(STUDENT_STATUSES.map((status) => [status, 0]));
  const unknown = new Map();
  for (const record of records) {
    const status = text(record.status) || 'UNSPECIFIED';
    if (Object.hasOwn(counts, status)) counts[status] += 1;
    else unknown.set(status, (unknown.get(status) ?? 0) + 1);
  }
  const recordedDates = new Set(records.map((record) => text(record.date ?? record.attendanceDate ?? record.attendance_date)).filter(Boolean));
  const denominator = attendancePercentageDenominator(records);
  return {
    recordedDays: recordedDates.size,
    present: counts.PRESENT,
    absent: counts.ABSENT,
    late: counts.LATE,
    earlyDeparture: counts.EARLY_DEPARTURE,
    excusedAbsence: counts.EXCUSED_ABSENCE,
    unexcusedAbsence: counts.UNEXCUSED_ABSENCE,
    sickAbsence: counts.SICK_ABSENCE,
    recordedAttendancePercentage: denominator ? attendancePercentage(records) : null,
    unknownStatuses: [...unknown].map(([status, count]) => ({ status, count }))
  };
}

function attendanceRecordMatchesContext(record, actor, context) {
  const scopedFields = [
    [['schoolId', 'school_id'], actor.schoolId],
    [['academicYear', 'academic_year'], context.yearName],
    [['term'], context.termName],
    [['classId', 'class_id'], context.classId]
  ];
  return scopedFields.every(([keys, expected]) => {
    const actual = keys.map((key) => record?.[key]).find((value) => value !== undefined && value !== null);
    return actual === undefined || String(actual) === String(expected);
  });
}

export function createParentDashboardService({
  students,
  admissionEnrollment = null,
  attendance = null,
  attendanceRepository = null,
  sampleFixtureRepository = null,
  academicResults = null,
  durableAcademic = null,
  fees = null,
  parentFeeObligations = null,
  durableFeeReader = null,
  receiptBranding = null,
  examinations = null,
  historicalRecords = null,
  communication = null,
  academicCalendar = null,
  operations = null,
  assignments = null,
  cards = parentDashboardModules(),
  testParentSchoolId = TEST_PARENT_SCHOOL_ID
} = {}) {
  function componentSupport(moduleKey) {
    switch (moduleKey) {
      case 'parent-attendance': return Boolean(attendanceRepository?.listStudentRecords || attendance?.summary);
      case 'parent-results': return Boolean(academicResults?.publicationFor && academicResults?.result);
      case 'parent-fees': return Boolean(parentFeeObligations?.listForParent || fees?.statement);
      case 'parent-payments': return Boolean(durableFeeReader?.listReceipts || receiptBranding?.listForParent);
      case 'parent-timetable': return Boolean(examinations?.listTimetables);
      case 'parent-announcements': return Boolean(communication?.listAnnouncements);
      case 'parent-calendar': return Boolean(academicCalendar?.list);
      case 'parent-messages': return Boolean(communication?.listMessages);
      case 'parent-transport': return Boolean(operations?.list);
      case 'parent-assignments': return Boolean(assignments?.listForParent);
      default: return false;
    }
  }

  function parentTransportRecords(student, selectedActor) {
    const result = operations.list('TRANSPORT', selectedActor);
    const allowedIds = new Set(authorizedIds(student));
    const routesById = new Map(rows(result.routes).map((item) => [text(item.id), item]));
    const vehiclesById = new Map(rows(result.vehicles).map((item) => [text(item.id), item]));
    const assignments = rows(result.assignments)
      .filter((item) => allowedIds.has(text(item.studentId ?? item.student_id)))
      .map((item) => {
        const route = routesById.get(text(item.routeId ?? item.route_id));
        const vehicle = route ? vehiclesById.get(text(route.vehicleId ?? route.vehicle_id)) : null;
        const stopId = item.stopId ?? item.stop_id ?? item.pickupPoint ?? null;
        const stop = rows(route?.stops).find((candidate) => text(typeof candidate === 'string' ? candidate : candidate?.id) === text(stopId));
        return {
          id: item.id,
          routeName: route?.name ?? 'Assigned route',
          vehicleName: vehicle?.name ?? null,
          registrationNumber: vehicle?.registration ?? null,
          pickupPoint: stop ? (typeof stop === 'string' ? stop : stop.name ?? stop.label ?? stop.id) : stopId,
          status: item.status ?? route?.status ?? 'Assigned'
        };
      });
    return { assignments };
  }

  function componentCatalog(actor) {
    parentActor(actor);
    return cards.map((card) => {
      const configured = COMPONENTS.find((item) => item.moduleKey === card.moduleKey);
      const supported = componentSupport(card.moduleKey);
      const explicitlyUnavailable = ['parent-homework', 'parent-documents'].includes(card.moduleKey);
      return {
        moduleKey: card.moduleKey,
        moduleName: card.moduleName,
        route: card.route,
        recordType: configured?.recordType ?? null,
        scope: configured?.scope ?? 'student',
        requiresAcademicContext: Boolean(configured?.requiresAcademicContext),
        available: supported,
        status: supported ? 'AVAILABLE' : explicitlyUnavailable ? 'NOT_AVAILABLE_YET' : 'NOT_CONFIGURED',
        message: supported ? null : explicitlyUnavailable ? 'Not available yet.' : 'This Parent service is not configured.'
      };
    });
  }

  async function options(actor) {
    parentActor(actor);
    let source;
    try {
      source = durableAcademic ? await durableAcademic.options(actor) : academicResults?.options?.(actor);
    } catch (cause) {
      const error = Object.assign(new Error('Unable to load configured academic options.'), { status: 503, code: 'PARENT_ACADEMIC_OPTIONS_UNAVAILABLE', cause });
      throw error;
    }
    if (!source) fail('Academic options are not configured for this school.', 503, 'PARENT_ACADEMIC_OPTIONS_UNAVAILABLE');
    const academicYears = rows(source.academicYears).map(academicYearOption).filter(Boolean);
    const terms = rows(source.terms).map(termOption).filter(Boolean);
    const classes = canonicalClassOptions(source.classes);
    if (!academicYears.length) fail('No academic years are configured for this school. Configure an academic year in School Settings before loading student records.', 503, 'PARENT_ACADEMIC_YEARS_NOT_CONFIGURED');
    if (!terms.length) fail('No academic terms are configured for this school. Configure terms for an academic year before loading student records.', 503, 'PARENT_TERMS_NOT_CONFIGURED');
    if (!classes.length) fail('No classes are configured for this school. Configure classes before loading student records.', 503, 'PARENT_CLASSES_NOT_CONFIGURED');
    if (!classes.some((item) => item.id === 'COMPLETED')) classes.push({ id: 'COMPLETED', name: 'Completed / Graduated', contextOnly: true });
    const available = new Map(componentCatalog(actor).map((item) => [item.moduleKey, item.available]));
    const recordTypes = [
      { id: 'student-summary', name: 'Student Summary', available: true, scope: 'student', requiresAcademicContext: false },
      ...['attendance', 'published-results', 'fees', 'payments', 'payment-receipts', 'timetable', 'homework', 'assignments', 'transport', 'documents', 'promotion-history', 'completed-records'].map((id) => {
        const labels = { 'published-results': 'Published Results', 'payment-receipts': 'Payment Receipts', 'promotion-history': 'Promotion History', 'completed-records': 'Completed / Graduated Records' };
        const sourceModule = ({ attendance: 'parent-attendance', 'published-results': 'parent-results', fees: 'parent-fees', payments: 'parent-payments', 'payment-receipts': 'parent-payments', timetable: 'parent-timetable', transport: 'parent-transport' })[id] ?? id;
        const support = available.get(sourceModule) ?? false;
        const unsupported = id === 'assignments' && available.get('parent-assignments') ? null : UNSUPPORTED_RECORD_TYPES.find((item) => item.id === id);
        return { id, name: labels[id] ?? id.charAt(0).toUpperCase() + id.slice(1), available: unsupported ? false : support, scope: 'student', requiresAcademicContext: !['transport', 'documents', 'promotion-history', 'completed-records'].includes(id), ...(unsupported ? { message: unsupported.message } : !support ? { message: 'Not available yet.' } : {}) };
      }),
      ...[
        { id: 'historical-contexts', name: 'Historical Contexts', available: Boolean(historicalRecords?.listHistoricalContexts), requiresAcademicContext: false },
        { id: 'promotion-history', name: 'Promotion History', available: Boolean(historicalRecords?.listPromotionHistory), requiresAcademicContext: false },
        { id: 'completed-records', name: 'Completed / Graduated Records', available: Boolean(historicalRecords?.listCompletedRecords), requiresAcademicContext: false }
      ].filter((item) => item.available)
    ].filter((item) => item.available);
    const sampleContexts = isConfiguredTestParentActor(actor, testParentSchoolId)
      ? Object.fromEntries((await listChildren(actor)).map((child) => [child.permanentStudentId, listConfiguredSampleAcademicContexts({ actor, permanentStudentId: child.permanentStudentId, academicYears, terms, classes, schoolId: testParentSchoolId })]))
      : {};
    return { academicYears, terms, classes, recordTypes, components: componentCatalog(actor), sampleContexts };
  }

  async function listChildren(actor) {
    parentActor(actor);
    let children = [];
    if (isConfiguredTestParentActor(actor, testParentSchoolId)) {
      const relationships = listConfiguredTestParentRelationships(actor.id, testParentSchoolId);
      const sampleStudents = students?.listStudents?.({ requestedSchoolId: actor.schoolId, includeTestRecords: true, includeCompleted: true }) ?? [];
      children = relationships.map((link) => sampleStudents.find((student) => student.permanentStudentId === link.permanentStudentId && student.isTestRecord === true && student.schoolId === actor.schoolId)).filter(Boolean);
    } else if (admissionEnrollment?.listParentStudents) {
      children = await admissionEnrollment.listParentStudents({ parentUserId: actor.id, schoolId: actor.schoolId });
    } else {
      children = (students?.listStudents?.({ requestedSchoolId: actor.schoolId, includeCompleted: true }) ?? []).filter((student) => !student.isTestRecord && (students?.parentLinksFor?.(student.id, actor.schoolId) ?? []).some((link) => link.parentId === actor.id));
    }
    const unique = new Map();
    for (const child of children) {
      const permanentStudentId = text(child.permanentStudentId ?? child.permanent_student_id);
      if (!permanentStudentId || (!/^OSAAH\/\d{4}\/\d{4,}$/.test(permanentStudentId) && !isConfiguredTestStudentId(permanentStudentId))) continue;
      unique.set(permanentStudentId, childSummary(child));
    }
    return [...unique.values()];
  }

  async function resolveChild(actor, permanentStudentId) {
    parentActor(actor);
    const id = text(permanentStudentId);
    if (!/^OSAAH\/\d{4}\/\d{4,}$/.test(id) && !isConfiguredTestStudentId(id)) fail('Enter a valid Permanent Student ID.', 400, 'INVALID_PERMANENT_STUDENT_ID');
    const student = await authorizeParentStudent({ actor, permanentStudentId: id, students, admissionEnrollment, testParentSchoolId });
    if (!student) fail('This student is not linked to your registered parent account.', 403, 'PARENT_STUDENT_FORBIDDEN');
    return student;
  }

  async function legacyTermEvidence(actor, student, context, recordType) {
    const childIds = new Set(authorizedIds(student));
    try {
      if (recordType === 'attendance' && attendanceRepository?.listStudentRecords) {
        const records = await attendanceRepository.listStudentRecords({ schoolId: actor.schoolId, academicYear: context.yearName, term: context.canonicalTermName ?? context.termName, classId: context.classId, studentId: text(student.studentProfileId ?? student.student_profile_id ?? student.id ?? student.student_id) });
        return rows(records).some((row) => childIds.has(text(row.studentId ?? row.student_id)));
      }
      if (recordType === 'published-results' && academicResults?.publicationFor && academicResults?.result) {
        const publication = academicResults.publicationFor({ classId: context.classId, academicYear: context.yearId, term: context.termId, isSample: Boolean(student.isTestRecord ?? student.is_test_record), studentId: student.id ?? student.studentId ?? student.student_id });
        if (publication?.status !== 'PUBLISHED') return false;
        academicResults.result({ studentId: student.id ?? student.studentId ?? student.student_id, classId: context.classId, academicYear: context.yearId, term: context.termId, sample: Boolean(student.isTestRecord ?? student.is_test_record) }, { ...actor, children: [student], roleKey: 'HEADTEACHER', permissions: new Set(['*']) });
        return true;
      }
      if ((recordType === 'fees' || recordType === 'payments' || recordType === 'payment-receipts') && parentFeeObligations?.listForParent) {
        const result = await parentFeeObligations.listForParent(actor, { academicYearId: context.yearId, termId: context.termId, classId: context.classId, status: 'PUBLISHED' });
        const child = rows(result.children).find((item) => text(item.student?.permanentStudentId ?? item.student?.permanent_student_id) === text(student.permanentStudentId ?? student.permanent_student_id));
        if (recordType === 'fees') return rows(child?.obligations).length > 0;
        if (!durableFeeReader?.listReceipts) return false;
        const receipts = await durableFeeReader.listReceipts({}, actor);
        return rows(receipts).some((item) => text(item.permanentStudentId ?? item.permanent_student_id) === text(student.permanentStudentId ?? student.permanent_student_id) && String(item.academicYearId ?? '') === String(context.yearId) && String(item.termId ?? '') === String(context.termId) && (!item.classId || String(item.classId) === String(context.classId)));
      }
      if (recordType === 'timetable' && examinations?.listTimetables) return rows(examinations.listTimetables({ academicYearId: context.yearId, termId: context.termId, classId: context.classId }, { ...actor, children: [student] })).length > 0;
    } catch { return false; }
    return false;
  }

  async function validateContext(actor, input, student = null, recordType = 'student-summary') {
    const source = await options(actor);
    const yearInput = text(input.academicYear ?? input.academicYearId);
    const year = source.academicYears.find((item) => item.id === yearInput || item.name === yearInput);
    if (!year) fail('Select a configured academic year.', 400, 'INVALID_ACADEMIC_YEAR');
    const termInput = text(input.term ?? input.termId);
    const term = source.terms.find((item) => (item.id === termInput || normalizeTermName(item.name) === normalizeTermName(termInput)) && (!item.academicYearId || item.academicYearId === year.id));
    if (!term) fail('Select a term configured for the academic year.', 400, 'INVALID_TERM');
    const classInput = text(input.classId);
    const selectedClass = canonicalClassId(classInput);
    const classRecord = source.classes.find((item) => item.id === classInput || item.name === classInput)
      ?? (selectedClass ? source.classes.find((item) => canonicalClassId(item.name) === selectedClass || canonicalClassId(item.id) === selectedClass) : null);
    if (!classRecord) fail('Select a class from the configured class list.', 400, 'INVALID_CLASS');
    if (classRecord.contextOnly) fail('Select a historical class from Historical Contexts. Completed records do not require a class selection.', 400, 'INVALID_CLASS');
    if (student) {
      const enrolledClass = text(student.classId ?? student.class_id);
      const selectedCanonicalClass = canonicalClassId(classRecord.name);
      const enrolledCanonicalClass = canonicalClassId(enrolledClass);
      const classMatchesCurrentEnrollment = enrolledClass && (classRecord.id === enrolledClass || classRecord.name === enrolledClass || (selectedCanonicalClass && selectedCanonicalClass === enrolledCanonicalClass));
      const sampleContextAuthorized = isConfiguredSampleAcademicContext({ actor, permanentStudentId: text(student.permanentStudentId ?? student.permanent_student_id), academicYearId: year.id, termId: term.id, classId: classRecord.id, academicYears: source.academicYears, terms: source.terms, classes: source.classes, schoolId: testParentSchoolId });
      const classMatchesSelectedEnrollment = sampleContextAuthorized || (admissionEnrollment?.parentEnrolledInClass
        ? await admissionEnrollment.parentEnrolledInClass({ parentUserId: actor.id, schoolId: actor.schoolId, permanentStudentId: text(student.permanentStudentId ?? student.permanent_student_id), academicYearId: year.id, termId: term.id, termName: term.canonicalName ?? term.name, classId: classRecord.id, recordType, legacyTermEvidence: (scope) => legacyTermEvidence(actor, student, { yearId: scope.academicYearId, yearName: year.name, termId: scope.termId, termName: scope.termName, classId: scope.classId }, recordType) })
        : classMatchesCurrentEnrollment);
      if (!classMatchesSelectedEnrollment) fail('The selected class is not an authorized enrollment for this child and academic period.', 403, 'PARENT_CLASS_FORBIDDEN');
    }
    return { yearId: year.id, yearName: year.name, termId: term.id, termName: term.name, canonicalTermName: term.canonicalName ?? term.name, classId: classRecord.id, className: classRecord.name };
  }

  async function loadRecord(actor, input = {}) {
    parentActor(actor);
    const type = text(input.recordType);
    const permanentStudentId = text(input.permanentStudentId);
    const student = await resolveChild(actor, permanentStudentId);
    const name = studentName(student) || 'Authorized student';
    if (type === 'student-summary') {
      const context = input.academicYear && input.term && input.classId ? await validateContext(actor, input, student, type) : null;
      return { recordType: type, available: true, student: childSummary({ ...student, name, permanentStudentId }), context };
    }
    const availableTypes = (await options(actor)).recordTypes;
    const chosen = availableTypes.find((item) => item.id === type);
    if (!chosen) fail('Select a supported record type.', 400, 'INVALID_RECORD_TYPE');
    if (!chosen.available) fail(chosen.message ?? 'This information is not available yet.', 501, 'PARENT_RECORD_NOT_AVAILABLE');
    const context = chosen.requiresAcademicContext ? await validateContext(actor, input, student, type) : null;
    const childIds = authorizedIds(student);
    const selectedActor = { ...actor, children: [{ ...student, id: student.id ?? student.student_id ?? student.studentProfileId, studentProfileId: student.studentProfileId ?? student.student_profile_id, permanentStudentId, classId: student.classId ?? student.class_id, className: student.className ?? student.class_id }] };
    if (type === 'historical-contexts') {
      const contexts = await historicalRecords.listHistoricalContexts(actor, student);
      return { recordType: type, available: true, student: { name, permanentStudentId }, contexts: rows(contexts) };
    }
    if (type === 'promotion-history') {
      const records = await historicalRecords.listPromotionHistory(actor, student);
      return { recordType: type, available: true, student: { name, permanentStudentId }, records: rows(records) };
    }
    if (type === 'completed-records') {
      const records = await historicalRecords.listCompletedRecords(actor, student);
      return { recordType: type, available: true, student: { name, permanentStudentId }, records: rows(records) };
    }
    if (type === 'attendance') {
      const sampleFixture = isConfiguredTestParentActor(actor, testParentSchoolId) && sampleFixtureRepository
        ? await sampleFixtureRepository.getFixture({ schoolId: actor.schoolId, sampleStudentId: permanentStudentId, academicYearId: context.yearId, termId: context.termId, classId: context.classId, fixtureType: 'attendance', fixtureVersion: 1 }, actor)
        : null;
      if (sampleFixture) {
        const fixtureRecords = rows(sampleFixture.fixturePayload?.records).map((record) => ({
          ...record,
          schoolId: actor.schoolId,
          studentId: permanentStudentId,
          academicYear: context.yearName,
          term: context.termName,
          classId: context.classId
        }));
        return { recordType: type, available: true, student: { name, permanentStudentId }, context, attendanceSummary: attendanceSummary(fixtureRecords), records: fixtureRecords };
      }
      let records;
      if (attendanceRepository?.listStudentRecords) {
        const attendanceStudentId = text(student.studentProfileId ?? student.student_profile_id ?? student.id ?? student.student_id);
        records = await attendanceRepository.listStudentRecords({ schoolId: actor.schoolId, academicYear: context.yearName, term: context.termName, classId: context.classId, studentId: attendanceStudentId });
      } else {
        records = attendance.summary({ academicYear: context.yearName, term: context.termName, classId: context.classId, studentIds: childIds }).records;
      }
      const authorizedRecords = rows(records).filter((row) => childIds.includes(text(row.studentId ?? row.student_id)) && attendanceRecordMatchesContext(row, actor, context));
      return { recordType: type, available: true, student: { name, permanentStudentId }, context, attendanceSummary: attendanceSummary(authorizedRecords), records: authorizedRecords };
    }
    if (type === 'published-results') {
      const publication = academicResults.publicationFor({ classId: context.classId, academicYear: context.yearId, term: context.termId, isSample: Boolean(student.isTestRecord ?? student.is_test_record), studentId: student.id ?? student.studentId ?? student.student_id });
      if (publication?.status !== 'PUBLISHED') fail('No published result is available for this student and academic context.', 404, 'PARENT_RESULT_NOT_PUBLISHED');
      try {
        const result = academicResults.result({ studentId: student.id ?? student.studentId ?? student.student_id, classId: context.classId, academicYear: context.yearId, term: context.termId, sample: Boolean(student.isTestRecord ?? student.is_test_record) }, { ...selectedActor, roleKey: 'HEADTEACHER', permissions: new Set(['*']) });
        return { recordType: type, available: true, student: { name, permanentStudentId }, context, result };
      } catch {
        fail('The published result could not be loaded for this student and academic context.', 404, 'PARENT_RESULT_UNAVAILABLE');
      }
    }
    if (type === 'fees' || type === 'payments' || type === 'payment-receipts') {
      let obligations = [];
      let transactions = [];
      if (parentFeeObligations?.listForParent) {
        const result = await parentFeeObligations.listForParent(actor, { academicYearId: context.yearId, termId: context.termId, classId: context.classId, status: 'PUBLISHED' });
        const child = rows(result.children).find((item) => item.student?.permanentStudentId === permanentStudentId);
        obligations = rows(child?.obligations);
        const receipts = durableFeeReader?.listReceipts ? await durableFeeReader.listReceipts({}, actor) : [];
        transactions = rows(receipts).filter((item) => item.permanentStudentId === permanentStudentId && String(item.academicYearId ?? '') === context.yearId && String(item.termId ?? '') === context.termId && (!item.classId || String(item.classId) === context.classId));
      } else {
        const statement = fees.statement(student.id ?? student.studentId ?? student.student_id, actor.id, null, { academicYearId: context.yearId, termId: context.termId, classId: context.classId });
        obligations = rows(statement.invoices);
        transactions = rows(statement.payments);
      }
      const payable = obligations.reduce((sum, item) => sum + (item.amountMinor !== undefined ? Number(item.amountMinor) / 100 : Number(item.total ?? item.amount ?? 0)), 0);
      const paid = transactions.filter((item) => TERMINAL_PAYMENT_STATUSES.has(String(item.status ?? 'VALID').toUpperCase())).reduce((sum, item) => sum + (item.amountMinor !== undefined ? Number(item.amountMinor) / 100 : Number(item.amount ?? item.amountPaid ?? 0)), 0);
      const summary = { feesPayable: payable, amountPaid: paid, outstandingBalance: Math.max(0, payable - paid), currency: 'GHS', hasRecords: obligations.length > 0 || transactions.length > 0 };
      if (type === 'fees') return { recordType: type, available: true, student: { name, permanentStudentId }, context, summary, obligations };
      return { recordType: type, available: true, student: { name, permanentStudentId }, context, summary, payments: transactions, receipts: transactions.filter((item) => item.receiptNumber) };
    }
    if (type === 'timetable') {
      const timetables = examinations.listTimetables({ academicYearId: context.yearId, termId: context.termId, classId: context.classId }, selectedActor);
      return { recordType: type, available: true, student: { name, permanentStudentId }, context, records: rows(timetables) };
    }
    if (type === 'assignments') {
      const records = await assignments.listForParent(selectedActor, student, { academicYearId: context.yearId, termId: context.termId });
      return { recordType: type, available: true, student: { name, permanentStudentId }, context, records };
    }
    if (type === 'transport') {
      return { recordType: type, available: true, student: { name, permanentStudentId }, records: parentTransportRecords(student, selectedActor) };
    }
    fail('This information is not available yet.', 501, 'PARENT_RECORD_NOT_AVAILABLE');
  }

  async function component(actor, moduleKey, input = {}) {
    parentActor(actor);
    const definition = COMPONENTS.find((item) => item.moduleKey === moduleKey);
    const card = cards.find((item) => item.moduleKey === moduleKey);
    if (!definition || !card) fail('Parent component not found.', 404, 'PARENT_COMPONENT_NOT_FOUND');
    const available = componentSupport(moduleKey);
    if (!available) fail('Not available yet.', 501, 'PARENT_COMPONENT_NOT_AVAILABLE');
    const permanentStudentId = text(input.permanentStudentId);
    let student = null;
    if (definition.scope !== 'parent-and-child' || permanentStudentId) {
      student = await resolveChild(actor, permanentStudentId);
    }
    const selectedActor = student ? { ...actor, children: [{ ...student, id: student.id ?? student.student_id ?? student.studentProfileId, studentProfileId: student.studentProfileId ?? student.student_profile_id, permanentStudentId, classId: student.classId ?? student.class_id, className: student.className ?? student.class_id }] } : { ...actor, children: [] };
    if (moduleKey === 'parent-announcements') return { moduleKey, moduleName: card.moduleName, student: student ? { name: studentName(student), permanentStudentId } : null, records: communication.listAnnouncements(selectedActor) };
    if (moduleKey === 'parent-calendar') {
      const filters = {};
      if (input.academicYear || input.term) {
        const academic = await options(actor);
        const yearInput = text(input.academicYear);
        const year = academic.academicYears.find((item) => item.id === yearInput || item.name === yearInput);
        if (!year) fail('Select a configured academic year.', 400, 'INVALID_ACADEMIC_YEAR');
        const termInput = text(input.term);
        const term = academic.terms.find((item) => (item.id === termInput || normalizeTermName(item.name) === normalizeTermName(termInput)) && (!item.academicYearId || item.academicYearId === year.id));
        if (!term) fail('Select a term configured for the academic year.', 400, 'INVALID_TERM');
        Object.assign(filters, { academicYear: year.id, term: term.id });
      }
      return { moduleKey, moduleName: card.moduleName, student: student ? { name: studentName(student), permanentStudentId } : null, records: await academicCalendar.list(filters, selectedActor) };
    }
    if (moduleKey === 'parent-messages') {
      const linkedChildren = student ? [] : await listChildren(actor);
      const linkedStudents = student ? [student] : await Promise.all(linkedChildren.map((child) => resolveChild(actor, child.permanentStudentId)));
      const ids = [...new Set(linkedStudents.flatMap(authorizedIds))];
      return { moduleKey, moduleName: card.moduleName, student: student ? { name: studentName(student), permanentStudentId } : null, records: communication.listMessages(selectedActor, ids) };
    }
    if (moduleKey === 'parent-transport') {
      return { recordType: 'transport', available: true, student: { name: studentName(student), permanentStudentId }, records: parentTransportRecords(student, selectedActor) };
    }
    if (moduleKey === 'parent-timetable' || moduleKey === 'parent-attendance' || moduleKey === 'parent-results' || moduleKey === 'parent-fees' || moduleKey === 'parent-payments' || moduleKey === 'parent-assignments') {
      const recordType = definition.recordType;
      return await loadRecord(actor, { ...input, recordType, permanentStudentId });
    }
    return { moduleKey, moduleName: card.moduleName, student: student ? { name: studentName(student), permanentStudentId } : null, records: [], available: false, message: 'Not available yet.' };
  }

  return Object.freeze({ options, listChildren, resolveChild, childSummary, loadRecord, component, componentCatalog });
}
