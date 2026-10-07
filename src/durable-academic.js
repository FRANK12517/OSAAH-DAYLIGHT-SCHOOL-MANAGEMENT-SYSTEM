import { createHash, randomUUID } from 'node:crypto';
import { gradeForTotal } from './grading.js';
import { canonicalAcademicClass, defaultSubjectForClass, defaultSubjectsForClass, DEFAULT_SUBJECT_CONFIGURATION_VERSION, DEFAULT_SUBJECT_ASSIGNMENT_SLOTS, DEFAULT_DISTINCT_SUBJECT_NAMES } from './default-subject-catalog.js';
import { calculateStudentResult, calculateClassPositions } from './result-calculation.js';

const rows = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? '').trim();
const fail = (message, status = 400, code = 'ACADEMIC_DATA_ERROR', details = null) => { throw Object.assign(new Error(message), { status, code, details }); };
const schemaCompatibilityError = (error) => /unknown column|doesn'?t exist|no such table|table .* does not exist/i.test(String(error?.message ?? error));
async function historicalAcademicCounts(database, schoolId) {
  const tables = new Set(rows(await database.query(
    "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('academic_score_records','academic_result_records')"
  )).map((row) => row.tableName ?? row.TABLE_NAME));
  const count = async (table, where = 'school_id=?', params = [schoolId]) => Number(rows(await database.query(
    `SELECT COUNT(*) AS rowCount FROM ${table} WHERE ${where}`, params
  ))[0]?.rowCount ?? 0);
  const result = { academicScoreRecords: 0, academicResultRecords: 0, publishedResults: 0 };
  if (tables.has('academic_score_records')) result.academicScoreRecords = await count('academic_score_records');
  if (tables.has('academic_result_records')) {
    result.academicResultRecords = await count('academic_result_records');
    result.publishedResults = await count('academic_result_records', 'school_id=? AND status=?', [schoolId, 'PUBLISHED']);
  }
  return result;
}
const MOCK_TYPES = Object.freeze(Array.from({ length: 10 }, (_, index) => `${index + 1}${index === 0 ? 'st' : index === 1 ? 'nd' : index === 2 ? 'rd' : 'th'} Mock`));
const JHS_CLASSES = new Set(['JHS 1', 'JHS 2', 'JHS 3']);

function authorized(actor, permission) {
  return actor?.permissions?.has?.('*') || actor?.permissions?.has?.(permission) || actor?.roleKey === 'PROPRIETOR';
}

export function createDurableAcademicService({ database, schoolId, signatures = null, idFactory = randomUUID, clock = () => new Date().toISOString() } = {}) {
  if (!database?.query || !database?.execute) fail('Durable academic database is unavailable.', 503, 'DURABLE_ACADEMIC_DATABASE_REQUIRED');

  function assertActor(actor, permission = null) {
    if (!actor?.schoolId || actor.schoolId !== schoolId) fail('Forbidden.', 403, 'TENANT_SCOPE_VIOLATION');
    if (permission && !authorized(actor, permission)) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
  }

  function assertClassScope(classId, actor) {
    if (!classId) fail('Class is required.');
    if (actor?.assignedClassIds?.length && !actor.assignedClassIds.includes(classId)) fail('Class is outside your assignment.', 403, 'CLASS_SCOPE_DENIED');
  }

  async function classFor(classId) {
    const item = rows(await database.query('SELECT id,name FROM classes WHERE school_id=? AND id=? LIMIT 1', [schoolId, classId]))[0];
    if (!item) fail('Class not found.', 404, 'CLASS_NOT_FOUND');
    return item;
  }

  function stableId(prefix, ...parts) {
    return `${prefix}-${createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 32)}`;
  }

  async function options(actor) {
    assertActor(actor);
    const [academicYears, terms] = await Promise.all([
      database.query('SELECT id,name,starts_on AS startsOn,ends_on AS endsOn,is_current AS isCurrent FROM academic_years WHERE school_id=? ORDER BY starts_on DESC,id', [schoolId]),
      database.query('SELECT t.id,t.academic_year_id AS academicYearId,t.name,t.starts_on AS startsOn,t.ends_on AS endsOn,t.is_current AS isCurrent FROM terms t JOIN academic_years y ON y.id=t.academic_year_id WHERE y.school_id=? ORDER BY t.starts_on ASC,t.id', [schoolId])
    ]);
    let classes;
    try {
      // Production's canonical class catalogue is the existing classes table.
      // Do not join levels here: older production rows use classes.school_id,
      // classes.level, and classes.sort_order rather than classes.level_id.
      classes = await database.query('SELECT c.id,c.name,c.sort_order AS displayOrder,c.level AS levelName FROM classes c WHERE c.school_id=? ORDER BY c.sort_order,c.id', [schoolId]);
    } catch (error) {
      if (!schemaCompatibilityError(error)) throw error;
      try {
        // Some production revisions have the tenant key and class names but
        // not the optional ordering/level columns. Names and IDs are enough
        // for Score Entry; do not fail because presentation metadata was not
        // migrated.
        classes = await database.query('SELECT c.id,c.name FROM classes c WHERE c.school_id=? ORDER BY c.id', [schoolId]);
      } catch (minimalError) {
        if (!schemaCompatibilityError(minimalError)) throw minimalError;
        // Keep compatibility with the normalized foundation schema used by
        // installations where classes are tenant-scoped through levels.
        classes = await database.query('SELECT c.id,c.name,c.display_order AS displayOrder,l.name AS levelName FROM classes c JOIN levels l ON l.id=c.level_id WHERE l.school_id=? ORDER BY c.display_order,c.id', [schoolId]);
      }
    }
    const allowedClasses = rows(classes).filter((item) => !actor?.assignedClassIds?.length || actor.assignedClassIds.includes(item.id));
    return { academicYears: rows(academicYears), terms: rows(terms), classes: allowedClasses, mockTypes: [...MOCK_TYPES] };
  }

  function decorateSubject(subject, classId) {
    const configured = defaultSubjectForClass(subject.className ?? classId, subject.name);
    if (!configured) return subject;
    return {
      ...subject,
      subjectType: configured?.subjectType ?? subject.subjectType ?? 'ELECTIVE',
      isScoring: configured ? configured.isScoring : Number(subject.isScoring ?? 1) !== 0,
      mandatory: Boolean(configured?.mandatory),
      optional: Boolean(configured?.optional),
      maximumMarks: configured?.maximumMarks ?? 100,
      configurationVersion: configured?.configurationVersion ?? null,
      assessmentComponents: configured?.assessmentComponents ?? []
    };
  }

  async function configureDefaultSubjects(actor, { academicYearId: requestedYearId = null } = {}) {
    assertActor(actor, 'subjects.manage');
    const sync = async (tx) => {
      let academicYearId = text(requestedYearId) || null;
      if (academicYearId) {
        const year = rows(await tx.query('SELECT id FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, academicYearId, academicYearId]))[0];
        if (!year) fail('Academic year not found.', 404, 'ACADEMIC_YEAR_NOT_FOUND');
        academicYearId = text(year.id);
      }
      const classes = rows(await tx.query('SELECT c.id,c.name FROM classes c WHERE c.school_id=? ORDER BY c.id', [schoolId]));
      const duplicateSubjects = rows(await tx.query('SELECT LOWER(name) AS normalizedName,COUNT(*) AS recordCount FROM subjects WHERE school_id=? GROUP BY LOWER(name) HAVING COUNT(*)>1', [schoolId]));
      if (duplicateSubjects.length) fail('Duplicate subject names require manual reconciliation before synchronization.', 409, 'DUPLICATE_SUBJECTS', { duplicateSubjects });
      const historyBefore = await historicalAcademicCounts(tx, schoolId);
      let classesConfigured = 0, subjectsCreated = 0, assignmentsCreated = 0, mandatoryAssignmentsRestored = 0;
      const nurseryNames = new Set(classes.flatMap((item) => canonicalAcademicClass(item.name)?.startsWith('Nursery') ? defaultSubjectsForClass(item.name).map((item) => item.name.toLocaleLowerCase('en')) : []));
      for (const classRow of classes) {
        const classId = canonicalAcademicClass(classRow.name);
        if (!classId) continue;
        const defaults = defaultSubjectsForClass(classId);
        if (!defaults.length) continue;
        classesConfigured += 1;
        for (const definition of defaults) {
          const matches = rows(await tx.query('SELECT id,code,name,subject_type AS subjectType,is_scoring AS isScoring,is_active AS isActive,assessment_components_json AS assessmentComponentsJson FROM subjects WHERE school_id=? AND LOWER(name)=LOWER(?) LIMIT 2', [schoolId, definition.name]));
          if (matches.length > 1) fail(`Duplicate subject records exist for ${definition.name}.`, 409, 'DUPLICATE_SUBJECTS', { subjectName: definition.name });
          let subject = matches[0];
          if (!subject) {
            const codeStem = `CFG_${definition.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`.slice(0, 28);
            let code = codeStem, suffix = 1;
            while (rows(await tx.query('SELECT id FROM subjects WHERE school_id=? AND code=? LIMIT 1', [schoolId, code])).length) {
              suffix += 1;
              code = `${codeStem.slice(0, 27 - String(suffix).length)}_${suffix}`;
            }
            const subjectId = stableId('default-subject', schoolId, definition.name.toLocaleLowerCase('en'));
            await tx.execute('INSERT INTO subjects (id,school_id,department_id,code,name,subject_type,is_scoring,assessment_components_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id', [subjectId, schoolId, null, code, definition.name, definition.subjectType, definition.isScoring ? 1 : 0, JSON.stringify(definition.assessmentComponents), clock(), clock()]);
            subject = rows(await tx.query('SELECT id,code,name,subject_type AS subjectType,is_scoring AS isScoring,is_active AS isActive,assessment_components_json AS assessmentComponentsJson FROM subjects WHERE school_id=? AND LOWER(name)=LOWER(?) LIMIT 2', [schoolId, definition.name]))[0];
            if (!subject) fail(`Unable to create the configured subject ${definition.name}.`, 409, 'SUBJECT_CONFIGURATION_CONFLICT');
            subjectsCreated += 1;
          }
          // Subject metadata is global, while approved classification can vary by class.
          // The class-specific catalogue overlay remains authoritative; never mutate any
          // subject used by Nursery as part of the default sync.
          if (!nurseryNames.has(definition.name.toLocaleLowerCase('en'))) {
            let storedComponents = subject.assessmentComponentsJson ?? [];
            if (typeof storedComponents === 'string') { try { storedComponents = JSON.parse(storedComponents); } catch { storedComponents = []; } }
            const components = definition.assessmentComponents ?? [];
            if (String(subject.subjectType ?? '').toUpperCase() !== definition.subjectType || Number(subject.isScoring ?? 1) !== (definition.isScoring === false ? 0 : 1) || JSON.stringify(Array.isArray(storedComponents) ? storedComponents : []) !== JSON.stringify(components)) {
              await tx.execute('UPDATE subjects SET subject_type=?,is_scoring=?,assessment_components_json=?,updated_at=? WHERE id=? AND school_id=?', [definition.subjectType, definition.isScoring === false ? 0 : 1, JSON.stringify(components), clock(), subject.id, schoolId]);
            }
          }
          if (definition.mandatory && Number(subject.isActive ?? 1) === 0 && !academicYearId && !classId.startsWith('Nursery')) await tx.execute('UPDATE subjects SET is_active=1,updated_at=? WHERE id=? AND school_id=?', [clock(), subject.id, schoolId]);
          if (definition.activeByDefault === false) continue;

          const scopes = academicYearId
            ? rows(await tx.query('SELECT id,active,academic_year_id AS academicYearId FROM subject_class_assignments WHERE school_id=? AND subject_id=? AND class_id=? AND (academic_year_id IS NULL OR academic_year_id=?) ORDER BY academic_year_id', [schoolId, subject.id, classRow.id, academicYearId]))
            : rows(await tx.query('SELECT id,active,academic_year_id AS academicYearId FROM subject_class_assignments WHERE school_id=? AND subject_id=? AND class_id=? AND academic_year_id IS NULL LIMIT 2', [schoolId, subject.id, classRow.id]));
          const scopedDuplicates = scopes.filter((item) => (item.academicYearId ?? null) === academicYearId);
          if (scopedDuplicates.length > 1) fail('Duplicate class-subject assignments require manual reconciliation.', 409, 'DUPLICATE_SUBJECT_ASSIGNMENTS', { classId: classRow.id, subjectId: subject.id, academicYearId });
          const yearAssignment = academicYearId ? scopes.find((item) => text(item.academicYearId) === academicYearId) : null;
          const globalAssignment = academicYearId ? scopes.find((item) => !item.academicYearId) : null;
          const existing = yearAssignment ?? globalAssignment ?? scopes[0];
          if (existing && (!academicYearId || yearAssignment || Number(existing.active ?? 1) === 1 || !definition.mandatory)) {
            const shouldRestore = definition.mandatory && Number(existing.active) === 0 && (!academicYearId || Boolean(yearAssignment));
            // Preserve Nursery configuration byte-for-byte except the already-approved
            // repair of an inactive mandatory assignment.
            if (shouldRestore || (!classId.startsWith('Nursery') && Boolean(yearAssignment || !academicYearId))) {
              await tx.execute('UPDATE subject_class_assignments SET active=?,configuration_version=?,updated_at=? WHERE id=? AND school_id=?', [shouldRestore ? 1 : existing.active, String(DEFAULT_SUBJECT_CONFIGURATION_VERSION), clock(), existing.id, schoolId]);
              if (shouldRestore) mandatoryAssignmentsRestored += 1;
            }
            continue;
          }
          const targetYear = academicYearId;
          const insert = await tx.execute('INSERT INTO subject_class_assignments (id,school_id,subject_id,class_id,academic_year_id,active,configuration_version,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?,?) ON DUPLICATE KEY UPDATE id=id', [stableId('default-assignment', schoolId, classRow.id, subject.id, targetYear ?? 'default'), schoolId, subject.id, classRow.id, targetYear, String(DEFAULT_SUBJECT_CONFIGURATION_VERSION), clock(), clock()]);
          if (Number(insert?.affectedRows ?? 1) > 0) assignmentsCreated += 1;
        }
      }
      const historyAfter = await historicalAcademicCounts(tx, schoolId);
      if (JSON.stringify(historyBefore) !== JSON.stringify(historyAfter)) fail(
        'Historical academic records changed during default subject synchronization.',
        409,
        'HISTORICAL_RECORDS_CHANGED',
        { before: historyBefore, after: historyAfter }
      );
      return { schoolId, academicYearId, configurationVersion: DEFAULT_SUBJECT_CONFIGURATION_VERSION, classesConfigured, subjectsCreated, assignmentsCreated, mandatoryAssignmentsRestored, expectedBaseline: { assignmentSlots: DEFAULT_SUBJECT_ASSIGNMENT_SLOTS, distinctSubjectNames: DEFAULT_DISTINCT_SUBJECT_NAMES }, nurseryPreserved: true };
    };
    if (typeof database.transaction !== 'function') fail('Default subject synchronization requires a database transaction.', 503, 'SUBJECT_SYNC_TRANSACTION_REQUIRED');
    try { return await database.transaction(sync); }
    catch (error) {
      if (schemaCompatibilityError(error)) fail('Subject configuration requires the approved subject database migrations.', 503, 'SUBJECT_CONFIGURATION_SCHEMA_UNAVAILABLE');
      throw error;
    }
  }

  async function subjectCatalog(actor, { includeInactive = false } = {}) {
    assertActor(actor);
    let subjectRows;
    try { subjectRows = rows(await database.query('SELECT id,code,name,department_id AS departmentId,subject_type AS subjectType,is_scoring AS isScoring,is_active AS isActive,assessment_components_json AS assessmentComponentsJson FROM subjects WHERE school_id=? ORDER BY name,id', [schoolId])); }
    catch (error) { if (schemaCompatibilityError(error)) fail('Durable subject configuration is unavailable until the required subject database migrations are applied.', 503, 'SUBJECT_CONFIGURATION_SCHEMA_UNAVAILABLE'); throw error; }
    let assignmentRows = [];
    try {
      assignmentRows = rows(await database.query('SELECT a.subject_id AS subjectId,a.class_id AS classId,a.active,c.name AS className FROM subject_class_assignments a JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id WHERE a.school_id=? ORDER BY c.id', [schoolId]));
    } catch (error) {
      if (!schemaCompatibilityError(error)) throw error;
      try {
        assignmentRows = rows(await database.query('SELECT cs.subject_id AS subjectId,cs.class_id AS classId,c.name AS className,1 AS active FROM class_subjects cs JOIN classes c ON c.id=cs.class_id AND c.school_id=? WHERE c.school_id=? ORDER BY c.id', [schoolId, schoolId]));
      } catch (legacyError) { if (!schemaCompatibilityError(legacyError)) throw legacyError; }
    }
    const result = subjectRows.map((subject) => {
      const assignments = assignmentRows.filter((item) => item.subjectId === subject.id);
      const active = Number(subject.isActive ?? 1) === 1 && (!assignments.length || assignments.some((item) => Number(item.active ?? 1) === 1));
      let assessmentComponents = subject.assessmentComponentsJson ?? [];
      if (typeof assessmentComponents === 'string') { try { assessmentComponents = JSON.parse(assessmentComponents); } catch { assessmentComponents = []; } }
      return { id: subject.id, code: subject.code, name: subject.name, departmentId: subject.departmentId ?? null, subjectType: subject.subjectType ?? 'ELECTIVE', isScoring: Number(subject.isScoring ?? 1) !== 0, active, classIds: [...new Set(assignments.map((item) => item.classId))], classNames: [...new Set(assignments.map((item) => item.className ?? item.classId))], assessmentComponents: Array.isArray(assessmentComponents) ? assessmentComponents : [] };
    });
    const scoped = actor?.assignedClassIds?.length
      ? result.map((subject) => {
        const allowedAssignments = assignmentRows.filter((item) => item.subjectId === subject.id && actor.assignedClassIds.includes(item.classId));
        return { ...subject, classIds: [...new Set(allowedAssignments.map((item) => item.classId))], classNames: [...new Set(allowedAssignments.map((item) => item.className ?? item.classId))] };
      }).filter((subject) => subject.classIds.length > 0)
      : result;
    return includeInactive ? scoped : scoped.filter((subject) => subject.active);
  }

  async function createSubject(input = {}, actor) {
    assertActor(actor, 'subjects.manage');
    const name = text(input.name);
    if (!name) fail('Subject name is required.');
    const duplicate = rows(await database.query('SELECT id FROM subjects WHERE school_id=? AND LOWER(name)=LOWER(?) LIMIT 1', [schoolId, name]))[0];
    if (duplicate) fail('Subject already exists.', 409, 'SUBJECT_ALREADY_EXISTS');
    const codeBase = text(input.code).toUpperCase() || `CUSTOM_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`.slice(0, 32);
    let code = codeBase, suffix = 1;
    while (rows(await database.query('SELECT id FROM subjects WHERE school_id=? AND code=? LIMIT 1', [schoolId, code])).length) {
      suffix += 1;
      code = `${codeBase.slice(0, 31 - String(suffix).length)}_${suffix}`;
    }
    const subjectType = text(input.subjectType).toUpperCase() || 'ELECTIVE';
    if (!['CORE', 'ELECTIVE', 'NON_SCORING'].includes(subjectType)) fail('Subject type must be CORE, ELECTIVE, or NON_SCORING.');
    const isScoring = subjectType !== 'NON_SCORING' && input.isScoring !== false && Number(input.isScoring) !== 0;
    const id = idFactory();
    await database.execute('INSERT INTO subjects (id,school_id,department_id,code,name,subject_type,is_scoring,assessment_components_json,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, schoolId, input.departmentId ?? null, code, name, subjectType, isScoring ? 1 : 0, JSON.stringify(Array.isArray(input.assessmentComponents) ? input.assessmentComponents : []), 1, clock(), clock()]);
    return { id, schoolId, departmentId: input.departmentId ?? null, code, name, subjectType, isScoring, mandatory: false, active: true, classIds: [], assessmentComponents: Array.isArray(input.assessmentComponents) ? input.assessmentComponents : [] };
  }

  async function updateSubject(subjectId, input = {}, actor) {
    assertActor(actor, 'subjects.manage');
    const current = rows(await database.query('SELECT id,code,name,subject_type AS subjectType,is_scoring AS isScoring FROM subjects WHERE id=? AND school_id=? LIMIT 1', [text(subjectId), schoolId]))[0];
    if (!current) fail('Subject not found.', 404, 'SUBJECT_NOT_FOUND');
    const assignments = rows(await database.query('SELECT a.active,c.name AS className FROM subject_class_assignments a JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id WHERE a.school_id=? AND a.subject_id=?', [schoolId, text(subjectId)]));
    const protectsMandatory = assignments.some((assignment) => defaultSubjectForClass(assignment.className, current.name)?.mandatory);
    if (protectsMandatory && (input.name !== undefined && text(input.name).toLowerCase() !== current.name.toLowerCase() || input.isScoring === false || Number(input.isScoring) === 0 || String(input.subjectType ?? current.subjectType).toUpperCase() === 'NON_SCORING')) fail('Mandatory core subjects cannot be renamed or made non-scoring.');
    const name = input.name === undefined ? current.name : text(input.name);
    if (!name) fail('Subject name is required.');
    if (name.toLowerCase() !== current.name.toLowerCase() && rows(await database.query('SELECT id FROM subjects WHERE school_id=? AND LOWER(name)=LOWER(?) AND id<>? LIMIT 1', [schoolId, name, text(subjectId)])).length) fail('Subject already exists.', 409, 'SUBJECT_ALREADY_EXISTS');
    const code = input.code === undefined ? current.code : text(input.code).toUpperCase();
    const subjectType = input.subjectType === undefined ? current.subjectType : text(input.subjectType).toUpperCase();
    if (!['CORE', 'ELECTIVE', 'NON_SCORING'].includes(subjectType)) fail('Subject type must be CORE, ELECTIVE, or NON_SCORING.');
    const isScoring = input.isScoring === undefined ? Number(current.isScoring ?? 1) !== 0 : input.isScoring !== false && Number(input.isScoring) !== 0;
    await database.execute('UPDATE subjects SET name=?,code=?,subject_type=?,is_scoring=?,updated_at=? WHERE id=? AND school_id=?', [name, code, subjectType, isScoring ? 1 : 0, clock(), text(subjectId), schoolId]);
    return { ...current, name, code, subjectType, isScoring, updatedAt: clock() };
  }

  async function deactivateSubject(subjectId, actor) {
    assertActor(actor, 'subjects.manage');
    const subject = rows(await database.query('SELECT id,name FROM subjects WHERE id=? AND school_id=? LIMIT 1', [text(subjectId), schoolId]))[0];
    if (!subject) fail('Subject not found.', 404, 'SUBJECT_NOT_FOUND');
    const assignments = rows(await database.query('SELECT a.id,a.class_id AS classId,c.name AS className FROM subject_class_assignments a JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id WHERE a.school_id=? AND a.subject_id=?', [schoolId, text(subjectId)]));
    if (assignments.some((assignment) => defaultSubjectForClass(assignment.className, subject.name)?.mandatory)) fail('Mandatory core subjects cannot be deactivated.');
    await database.execute('UPDATE subjects SET is_active=0,updated_at=? WHERE id=? AND school_id=?', [clock(), text(subjectId), schoolId]);
    await database.execute('UPDATE subject_class_assignments SET active=0,updated_at=? WHERE school_id=? AND subject_id=?', [clock(), schoolId, text(subjectId)]);
    return { id: text(subjectId), schoolId, active: false, archived: true, historicalRecordsPreserved: true };
  }

  async function listSubjects(filters = {}, actor) {
    assertActor(actor);
    const classId = text(filters.classId);
    if (classId) assertClassScope(classId, actor);
    if (!classId) return subjectCatalog(actor, { includeInactive: filters.includeInactive === true || String(filters.includeInactive).toLowerCase() === 'true' });
    let academicYearId = text(filters.academicYearId || filters.academicYear);
    if (academicYearId) {
      const year = rows(await database.query('SELECT id FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, academicYearId, academicYearId]))[0];
      if (!year) fail('Academic year not found.', 404, 'ACADEMIC_YEAR_NOT_FOUND');
      academicYearId = text(year.id);
    }
    const includeInactive = filters.includeInactive === true || String(filters.includeInactive).toLowerCase() === 'true';
    const params = [schoolId, classId];
    let yearClause = '';
    if (academicYearId) { yearClause = ' AND (a.academic_year_id IS NULL OR a.academic_year_id=?)'; params.push(academicYearId); }
    try {
      const assignments = rows(await database.query(`SELECT s.id,s.code,s.name,s.department_id AS departmentId,s.subject_type AS subjectType,s.is_scoring AS isScoring,s.is_active AS subjectActive,a.class_id AS classId,c.name AS className,a.academic_year_id AS academicYearId,a.active AS assignmentActive,a.configuration_version AS configurationVersion
        FROM subject_class_assignments a JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
        JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id
        WHERE a.school_id=? AND a.class_id=?${yearClause} ORDER BY s.name,s.id`, params));
      if (assignments.length) {
        const bySubject = new Map();
        for (const item of assignments) {
          const key = text(item.id);
          const isYearOverride = Boolean(academicYearId && item.academicYearId && text(item.academicYearId) === academicYearId);
          const previous = bySubject.get(key);
          if (academicYearId && previous && previous.isYearOverride === isYearOverride) fail('Duplicate class-subject assignments require manual reconciliation.', 409, 'DUPLICATE_SUBJECT_ASSIGNMENTS', { classId, subjectId: key, academicYearId });
          if (!previous || (isYearOverride && !previous.isYearOverride)) bySubject.set(key, { item, isYearOverride });
        }
        return [...bySubject.values()].filter(({ item }) => includeInactive || (Number(item.assignmentActive ?? 1) === 1 && Number(item.subjectActive ?? 1) === 1)).map(({ item }) => {
          const { assignmentActive, ...subject } = item;
          return { ...decorateSubject(subject, classId), active: Number(assignmentActive ?? 1) === 1, subjectActive: Number(subject.subjectActive ?? 1) === 1 };
        });
      }
      // A mapping that exists only for another academic year must not leak into
      // this year's view through the legacy class_subjects compatibility path.
      const anyNormalizedMapping = rows(await database.query('SELECT id FROM subject_class_assignments WHERE school_id=? AND class_id=? LIMIT 1', [schoolId, classId]));
      if (anyNormalizedMapping.length) return [];
      return legacySubjects();
    } catch (error) {
      if (!schemaCompatibilityError(error)) throw error;
      if (filters.requireNormalized === true) fail('Year-scoped subject configuration requires the approved subject database migrations.', 503, 'SUBJECT_CONFIGURATION_SCHEMA_UNAVAILABLE');
      // Some production databases retain the original class_subjects mapping.
      // It is authoritative and already references canonical subject/class
      // records; do not create a second mapping table or duplicate assignments.
      return legacySubjects();
    }
    async function legacySubjects() {
      try {
        const result = await database.query(`SELECT s.id,s.code,s.name,s.department_id AS departmentId,s.subject_type AS subjectType,s.is_scoring AS isScoring,s.is_active AS subjectActive,cs.class_id AS classId,c.name AS className
          FROM class_subjects cs JOIN subjects s ON s.id=cs.subject_id AND s.school_id=?
          JOIN classes c ON c.id=cs.class_id AND c.school_id=?
          WHERE cs.class_id=? ORDER BY s.name,s.id`, [schoolId, schoolId, classId]);
        return rows(result).filter((subject) => includeInactive || Number(subject.subjectActive ?? 1) === 1).map((subject) => ({ ...decorateSubject(subject, classId), active: Number(subject.subjectActive ?? 1) === 1, subjectActive: Number(subject.subjectActive ?? 1) === 1 }));
      } catch (error) {
        if (!schemaCompatibilityError(error)) throw error;
        const result = await database.query(`SELECT s.id,s.code,s.name,s.department_id AS departmentId,s.is_active AS subjectActive,cs.class_id AS classId,c.name AS className
          FROM class_subjects cs JOIN subjects s ON s.id=cs.subject_id AND s.school_id=?
          JOIN classes c ON c.id=cs.class_id AND c.school_id=?
          WHERE cs.class_id=? ORDER BY s.name,s.id`, [schoolId, schoolId, classId]);
        return rows(result).filter((subject) => includeInactive || Number(subject.subjectActive ?? 1) === 1).map((subject) => ({ ...decorateSubject(subject, classId), active: Number(subject.subjectActive ?? 1) === 1, subjectActive: Number(subject.subjectActive ?? 1) === 1 }));
      }
    }
  }

  async function subjectConfiguration(actor, filters = {}) {
    assertActor(actor);
    const classId = text(filters.classId);
    const requestedYear = text(filters.academicYearId || filters.academicYear);
    if (!classId || !requestedYear) fail('Academic year and class are required.', 400, 'SUBJECT_CONFIGURATION_SCOPE_REQUIRED');
    assertClassScope(classId, actor);
    const [classRow, yearRows] = await Promise.all([
      classFor(classId),
      database.query('SELECT id,name FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, requestedYear, requestedYear])
    ]);
    const academicYear = rows(yearRows)[0];
    if (!academicYear) fail('Academic year not found.', 404, 'ACADEMIC_YEAR_NOT_FOUND');
    const [configuredSubjects, catalogue] = await Promise.all([
      listSubjects({ classId, academicYearId: academicYear.id, includeInactive: true, requireNormalized: true }, actor),
      subjectCatalog(actor, { includeInactive: true })
    ]);
    const configuredById = new Map(configuredSubjects.map((subject) => [text(subject.id), subject]));
    const approvedNames = new Set(defaultSubjectsForClass(classRow.name).map((definition) => definition.name.toLocaleLowerCase('en')));
    const subjects = catalogue.filter((subject) => configuredById.has(text(subject.id)) || approvedNames.has(text(subject.name).toLocaleLowerCase('en'))).map((subject) => {
      const configured = configuredById.get(text(subject.id));
      if (configured) return { ...configured, assigned: true };
      const decorated = decorateSubject({ ...subject, classId, className: classRow.name }, classId);
      return { ...decorated, active: false, subjectActive: subject.active !== false, assigned: false };
    }).sort((left, right) => text(left.name).localeCompare(text(right.name)));
    return { schoolId, academicYearId: text(academicYear.id), academicYear: academicYear.name, classId, className: classRow.name, subjects };
  }

  async function subjectAssigned(input, actor) {
    const subjectId = text(input.subjectId);
    const configured = await listSubjects({ classId: input.classId, academicYearId: input.academicYearId || input.academicYear }, actor);
    return configured.some((subject) => text(subject.id) === subjectId);
  }

  async function subjectCascade(input = {}, actor) {
    assertActor(actor);
    const classId = text(input.classId);
    assertClassScope(classId, actor);
    const period = await resolvePeriod(input);
    await classFor(classId);
    const configuredSubjects = await listSubjects({ classId, academicYearId: period.yearId }, actor);
    return { academicYearId: period.yearId, academicYear: period.yearName, termId: period.termId, term: period.termName, classId, subjects: configuredSubjects.filter((subject) => subject.active !== false && subject.subjectActive !== false && subject.isScoring !== false && Number(subject.isScoring) !== 0) };
  }

  async function scoringSubjectAssigned(input, actor) {
    if (!await subjectAssigned(input, actor)) return false;
    const configured = await listSubjects({ classId: input.classId, academicYearId: input.academicYearId || input.academicYear }, actor);
    const subject = configured.find((item) => text(item.id) === text(input.subjectId));
    return Boolean(subject && subject.isScoring !== false && Number(subject.isScoring) !== 0);
  }

  async function listAssignments(subjectId, actor) {
    assertActor(actor);
    const result = await database.query(`SELECT a.id,a.subject_id AS subjectId,a.class_id AS classId,a.academic_year_id AS academicYearId,a.configuration_version AS configurationVersion,a.active,c.name AS className
      FROM subject_class_assignments a JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
      JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id
      WHERE a.school_id=? AND a.subject_id=? ORDER BY c.id`, [schoolId, text(subjectId)]);
    return rows(result).filter((assignment) => !actor?.assignedClassIds?.length || actor.assignedClassIds.includes(assignment.classId));
  }

  async function assignSubject(input = {}, actor) {
    assertActor(actor, 'subjects.manage');
    const subjectId = text(input.subjectId || input.subject_id);
    const classId = text(input.classId || input.class_id);
    let academicYearId = text(input.academicYearId || input.academic_year_id) || null;
    if (!subjectId || !classId) fail('Subject and class are required.');
    assertClassScope(classId, actor);
    await classFor(classId);
    if (academicYearId) {
      const academicYear = rows(await database.query('SELECT id FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, academicYearId, academicYearId]))[0];
      if (!academicYear) fail('Academic year not found.', 404, 'ACADEMIC_YEAR_NOT_FOUND');
      academicYearId = text(academicYear.id);
    }
    const subject = rows(await database.query('SELECT id,name FROM subjects WHERE id=? AND school_id=? LIMIT 1', [subjectId, schoolId]))[0];
    if (!subject) fail('Subject not found.', 404);
    const existing = rows(await database.query('SELECT id,active FROM subject_class_assignments WHERE school_id=? AND subject_id=? AND class_id=? AND ((academic_year_id IS NULL AND ? IS NULL) OR academic_year_id=?) LIMIT 1', [schoolId, subjectId, classId, academicYearId, academicYearId]))[0];
    if (existing) {
      await database.execute('UPDATE subject_class_assignments SET active=1,configuration_version=?,updated_at=? WHERE id=? AND school_id=?', [String(DEFAULT_SUBJECT_CONFIGURATION_VERSION), clock(), existing.id, schoolId]);
      return { id: existing.id, schoolId, subjectId, classId, academicYearId, configurationVersion: DEFAULT_SUBJECT_CONFIGURATION_VERSION, active: true, created: false };
    }
    const id = idFactory();
    await database.execute('INSERT INTO subject_class_assignments (id,school_id,subject_id,class_id,academic_year_id,active,configuration_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [id, schoolId, subjectId, classId, academicYearId, 1, String(DEFAULT_SUBJECT_CONFIGURATION_VERSION), clock(), clock()]);
    return { id, schoolId, subjectId, classId, academicYearId, configurationVersion: DEFAULT_SUBJECT_CONFIGURATION_VERSION, active: true, created: true };
  }

  async function deactivateSubjectAssignment(input = {}, actor) {
    assertActor(actor, 'subjects.manage');
    const subjectId = text(input.subjectId || input.subject_id);
    const classId = text(input.classId || input.class_id);
    let academicYearId = text(input.academicYearId || input.academic_year_id) || null;
    if (!subjectId || !classId) fail('Subject and class are required.');
    assertClassScope(classId, actor);
    const classRow = await classFor(classId);
    if (academicYearId) {
      const year = rows(await database.query('SELECT id FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, academicYearId, academicYearId]))[0];
      if (!year) fail('Academic year not found.', 404, 'ACADEMIC_YEAR_NOT_FOUND');
      academicYearId = text(year.id);
    }
    const subject = rows(await database.query('SELECT id,name FROM subjects WHERE id=? AND school_id=? LIMIT 1', [subjectId, schoolId]))[0];
    if (!subject) fail('Subject not found.', 404, 'SUBJECT_NOT_FOUND');
    if (defaultSubjectForClass(classRow.name, subject.name)?.mandatory) fail('Mandatory core subjects cannot be deactivated.');
    const existing = rows(await database.query('SELECT id FROM subject_class_assignments WHERE school_id=? AND subject_id=? AND class_id=? AND ((academic_year_id IS NULL AND ? IS NULL) OR academic_year_id=?) LIMIT 1', [schoolId, subjectId, classId, academicYearId, academicYearId]))[0];
    if (existing) {
      await database.execute('UPDATE subject_class_assignments SET active=0,configuration_version=?,updated_at=? WHERE id=? AND school_id=?', [String(DEFAULT_SUBJECT_CONFIGURATION_VERSION), clock(), existing.id, schoolId]);
      return { id: existing.id, schoolId, subjectId, classId, academicYearId, configurationVersion: DEFAULT_SUBJECT_CONFIGURATION_VERSION, active: false, created: false, historicalRecordsPreserved: true };
    }
    const id = idFactory();
    await database.execute('INSERT INTO subject_class_assignments (id,school_id,subject_id,class_id,academic_year_id,active,configuration_version,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?,?)', [id, schoolId, subjectId, classId, academicYearId, String(DEFAULT_SUBJECT_CONFIGURATION_VERSION), clock(), clock()]);
    return { id, schoolId, subjectId, classId, academicYearId, configurationVersion: DEFAULT_SUBJECT_CONFIGURATION_VERSION, active: false, created: true, historicalRecordsPreserved: true };
  }

  async function resolvePeriod(input = {}) {
    const year = text(input.academicYearId || input.academicYear);
    const term = text(input.termId || input.term);
    if (!year || !term) fail('Academic year and term are required.');
    const yearRow = rows(await database.query('SELECT id,name FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, year, year]))[0];
    if (!yearRow) fail('Academic year not found.', 404);
    const termRow = rows(await database.query('SELECT t.id,t.name FROM terms t JOIN academic_years y ON y.id=t.academic_year_id WHERE y.school_id=? AND y.id=? AND (t.id=? OR t.name=?) LIMIT 1', [schoolId, yearRow.id, term, term]))[0];
    if (!termRow) fail('Term not found.', 404);
    return { yearId: yearRow.id, yearName: yearRow.name, termId: termRow.id, termName: termRow.name };
  }

  async function assertMockClass(classId) {
    if (JHS_CLASSES.has(classId)) return;
    const classRow = rows(await database.query('SELECT id,name FROM classes WHERE school_id=? AND id=? LIMIT 1', [schoolId, classId]))[0];
    if (!JHS_CLASSES.has(text(classRow?.name))) fail('Mock examinations are available for JHS 1, JHS 2, and JHS 3 only.');
  }

  async function roster(input = {}, actor) {
    assertActor(actor);
    if (!authorized(actor, 'marks.write') && !authorized(actor, 'results.read')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId);
    if (!classId || !text(input.subjectId)) fail('Class and subject are required.');
    assertClassScope(classId, actor);
    const period = await resolvePeriod(input);
    await classFor(classId);
    if (!await scoringSubjectAssigned({ classId, subjectId: input.subjectId, academicYearId: period.yearId }, actor)) fail('Subject is invalid for this class and academic context.', 400, 'INVALID_CLASS_SUBJECT');
    const result = await database.query(`SELECT s.id AS studentId,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname,
      e.class_id AS classId,r.ca_score AS caScore,r.examination_score AS examScore,r.total_score AS totalScore,r.grade,r.id AS scoreId
      FROM student_enrollments e JOIN students s ON s.id=e.student_id
      LEFT JOIN academic_score_records r ON r.school_id=e.school_id AND r.student_id IN (SELECT sp.id FROM student_profiles sp WHERE sp.student_master_id=s.id OR sp.student_id=s.permanent_student_id) AND r.subject_id=? AND r.class_id=e.class_id AND r.academic_year_id=? AND r.term_id=? AND r.record_type='TERMINAL' AND r.mock_label IS NULL
      WHERE e.school_id=? AND e.class_id=? AND e.academic_year_id=? AND e.term_id=? AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,1)=1 AND s.school_id=? AND COALESCE(s.student_status,'ACTIVE')='ACTIVE' AND COALESCE(s.is_test_record,0)=0
      ORDER BY s.last_name,s.first_name,s.id`, [text(input.subjectId), period.yearId, period.termId, schoolId, classId, period.yearId, period.termId, schoolId]);
    return rows(result).map((item) => ({ studentId: item.studentId, permanentStudentId: item.permanentStudentId, studentName: [item.firstName, item.middleName, item.surname].filter(Boolean).join(' '), classId: item.classId, caScore: item.caScore == null ? null : Number(item.caScore), examScore: item.examScore == null ? null : Number(item.examScore), totalScore: item.totalScore == null ? null : Number(item.totalScore), grade: item.grade ?? null, saved: Boolean(item.scoreId) }));
  }

  async function resultStudents(input = {}, actor) {
    assertActor(actor);
    if (!authorized(actor, 'results.read') && !authorized(actor, 'results.generate') && !authorized(actor, 'examinations.read')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId);
    if (!classId) return [];
    assertClassScope(classId, actor);
    const period = await resolvePeriod(input);
    await classFor(classId);
    const rosterProjection = `SELECT DISTINCT s.id AS studentId,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname,e.class_id AS classId
      FROM student_enrollments e JOIN students s ON s.id=e.student_id
      WHERE e.school_id=? AND e.class_id=? AND e.academic_year_id=? AND e.term_id=? AND s.school_id=? AND COALESCE(s.student_status,'ACTIVE')='ACTIVE' AND COALESCE(s.is_test_record,0)=0`;
    const params = [schoolId, classId, period.yearId, period.termId, schoolId];
    let result;
    try {
      result = await database.query(`${rosterProjection} AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,1)=1 ORDER BY s.last_name,s.first_name,s.id`, params);
    } catch (error) {
      if (!schemaCompatibilityError(error)) throw error;
      result = await database.query(`${rosterProjection} ORDER BY s.last_name,s.first_name,s.id`, params);
    }
    return rows(result).map((item) => ({ id: item.studentId, studentId: item.studentId, indexNumber: item.permanentStudentId, permanentStudentId: item.permanentStudentId, name: [item.firstName, item.middleName, item.surname].filter(Boolean).join(' '), classId: item.classId, isTestRecord: false }));
  }

  async function resultContext(input = {}, actor) {
    assertActor(actor);
    if (!authorized(actor, 'results.read') && !authorized(actor, 'results.generate') && !authorized(actor, 'results.publish') && !authorized(actor, 'examinations.read')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId);
    if (!classId) fail('Class is required.', 400, 'RESULT_CONTEXT_REQUIRED');
    assertClassScope(classId, actor);
    const [period, classRow] = await Promise.all([resolvePeriod(input), classFor(classId)]);
    return { classId, className: classRow.name, academicYearId: period.yearId, academicYear: period.yearName, termId: period.termId, term: period.termName };
  }

  async function saveScore(input = {}, actor) {
    assertActor(actor, 'marks.write');
    const classId = text(input.classId), subjectId = text(input.subjectId), studentId = text(input.studentId);
    const caScore = Number(input.caScore), examScore = Number(input.examScore);
    if (!classId || !subjectId || !studentId || !Number.isFinite(caScore) || !Number.isFinite(examScore)) fail('Student, class, subject, CA, and Exam are required.');
    if (caScore < 0 || caScore > 50) fail('CA score must be between 0 and 50.');
    if (examScore < 0 || examScore > 50) fail('Exam score must be between 0 and 50.');
    assertClassScope(classId, actor);
    const period = await resolvePeriod(input);
    await classFor(classId);
    const enrolled = rows(await database.query('SELECT e.student_id,s.permanent_student_id,c.name AS className FROM student_enrollments e JOIN students s ON s.id=e.student_id JOIN classes c ON c.id=e.class_id WHERE e.school_id=? AND e.student_id=? AND e.class_id=? AND e.academic_year_id=? AND COALESCE(e.enrollment_status,"ACTIVE")="ACTIVE" AND COALESCE(e.is_current,1)=1 LIMIT 1', [schoolId, studentId, classId, period.yearId]))[0];
    if (!enrolled) fail('Student is not enrolled in the selected class and academic year.', 400);
    if (!await scoringSubjectAssigned({ classId, subjectId, academicYearId: period.yearId }, actor)) fail('Subject is not assigned as a scoring subject for the selected class.', 400);
    const totalScore = caScore + examScore;
    const [grade, remark] = gradeForTotal(totalScore, { classId: enrolled.className, examination: 'TERMINAL' });
    const existing = rows(await database.query('SELECT id FROM academic_score_records WHERE school_id=? AND record_type="TERMINAL" AND mock_label IS NULL AND academic_year_id=? AND term_id=? AND class_id=? AND student_id IN (SELECT sp.id FROM student_profiles sp WHERE sp.student_master_id=? OR sp.student_id=?) AND subject_id=? LIMIT 1', [schoolId, period.yearId, period.termId, classId, studentId, enrolled.permanent_student_id, subjectId]))[0];
    const scoreId = existing?.id ?? idFactory();
    if (existing) await database.execute('UPDATE academic_score_records SET ca_score=?,examination_score=?,total_score=?,grade=?,remark=?,entered_by=?,updated_at=? WHERE id=? AND school_id=?', [caScore, examScore, totalScore, grade, remark, actor.id, clock(), scoreId, schoolId]);
    else {
      const profile = rows(await database.query('SELECT id FROM student_profiles WHERE school_id=? AND (student_master_id=? OR student_id=?) LIMIT 1', [schoolId, studentId, enrolled.permanent_student_id]))[0];
      if (!profile) fail('Student profile is unavailable for score persistence.', 409);
      await database.execute('INSERT INTO academic_score_records (id,school_id,record_type,academic_year_id,term_id,class_id,student_id,subject_id,ca_score,ca_max,examination_score,examination_max,total_score,grade,remark,entered_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [scoreId, schoolId, 'TERMINAL', period.yearId, period.termId, classId, profile.id, subjectId, caScore, 50, examScore, 50, totalScore, grade, remark, actor.id, clock()]);
    }
    return { id: scoreId, schoolId, studentId, permanentStudentId: enrolled.permanent_student_id, classId, subjectId, academicYear: period.yearName, term: period.termName, caScore, examScore, totalScore, grade, remark, saved: true };
  }

  async function mockRoster(input = {}, actor) {
    assertActor(actor);
    if (!authorized(actor, 'mock.scores.read') && !authorized(actor, 'mock.scores.write')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId), subjectId = text(input.subjectId), mockLabel = text(input.mockLabel);
    await assertMockClass(classId);
    if (!subjectId || !MOCK_TYPES.includes(mockLabel)) fail('Class, subject, and Mock Examination are required.');
    assertClassScope(classId, actor);
    const period = await resolvePeriod(input);
    await classFor(classId);
    if (!await scoringSubjectAssigned({ classId, subjectId, academicYearId: period.yearId }, actor)) return [];
    const result = await database.query(`SELECT s.id AS studentId,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname,
      r.total_score AS totalScore,r.grade,r.id AS scoreId
      FROM student_enrollments e JOIN students s ON s.id=e.student_id
      LEFT JOIN academic_score_records r ON r.school_id=e.school_id AND r.student_id IN (SELECT sp.id FROM student_profiles sp WHERE sp.student_master_id=s.id OR sp.student_id=s.permanent_student_id) AND r.subject_id=? AND r.class_id=e.class_id AND r.academic_year_id=? AND r.term_id=? AND r.record_type='MOCK' AND r.mock_label=?
      WHERE e.school_id=? AND e.class_id=? AND e.academic_year_id=? AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,1)=1 AND s.school_id=? AND COALESCE(s.student_status,'ACTIVE')='ACTIVE' AND COALESCE(s.is_test_record,0)=0
      ORDER BY s.last_name,s.first_name,s.id`, [subjectId, period.yearId, period.termId, mockLabel, schoolId, classId, period.yearId, schoolId]);
    return rows(result).map((item) => ({ studentId: item.studentId, permanentStudentId: item.permanentStudentId, studentName: [item.firstName, item.middleName, item.surname].filter(Boolean).join(' '), classId, subjectId, totalScore: item.totalScore == null ? null : Number(item.totalScore), grade: item.grade ?? null, saved: Boolean(item.scoreId) }));
  }

  async function saveMockScore(input = {}, actor) {
    assertActor(actor, 'mock.scores.write');
    const classId = text(input.classId), subjectId = text(input.subjectId), studentId = text(input.studentId), mockLabel = text(input.mockLabel);
    const totalScore = Number(input.totalScore);
    if (!classId || !subjectId || !studentId || !MOCK_TYPES.includes(mockLabel)) fail('Student, class, subject, Mock Examination, and Total Score are required.');
    await assertMockClass(classId);
    if (input.caScore !== undefined || input.examScore !== undefined) fail('Mock scores accept Total Score / 100 only.');
    if (!Number.isFinite(totalScore) || totalScore < 0 || totalScore > 100) fail('Score must be between 0 and 100.');
    assertClassScope(classId, actor);
    const period = await resolvePeriod(input);
    await classFor(classId);
    const enrolled = rows(await database.query('SELECT e.student_id,s.permanent_student_id,c.name AS className FROM student_enrollments e JOIN students s ON s.id=e.student_id JOIN classes c ON c.id=e.class_id WHERE e.school_id=? AND e.student_id=? AND e.class_id=? AND e.academic_year_id=? AND COALESCE(e.enrollment_status,"ACTIVE")="ACTIVE" AND COALESCE(e.is_current,1)=1 LIMIT 1', [schoolId, studentId, classId, period.yearId]))[0];
    if (!enrolled) fail('Student is not enrolled in the selected class and academic year.', 400);
    if (!await scoringSubjectAssigned({ classId, subjectId, academicYearId: period.yearId }, actor)) fail('Subject is not assigned as a scoring subject for the selected class.', 400);
    const [grade, remark] = gradeForTotal(totalScore, { classId: enrolled.className, examination: 'MOCK' });
    const existing = rows(await database.query('SELECT id FROM academic_score_records WHERE school_id=? AND record_type="MOCK" AND mock_label=? AND academic_year_id=? AND term_id=? AND class_id=? AND student_id IN (SELECT sp.id FROM student_profiles sp WHERE sp.student_master_id=? OR sp.student_id=?) AND subject_id=? LIMIT 1', [schoolId, mockLabel, period.yearId, period.termId, classId, studentId, enrolled.permanent_student_id, subjectId]))[0];
    const scoreId = existing?.id ?? idFactory();
    if (existing) await database.execute('UPDATE academic_score_records SET ca_score=0,ca_max=0,examination_score=?,examination_max=100,total_score=?,grade=?,remark=?,entered_by=?,updated_at=? WHERE id=? AND school_id=?', [totalScore, totalScore, grade, remark, actor.id, clock(), scoreId, schoolId]);
    else {
      const profile = rows(await database.query('SELECT id FROM student_profiles WHERE school_id=? AND (student_master_id=? OR student_id=?) LIMIT 1', [schoolId, studentId, enrolled.permanent_student_id]))[0];
      if (!profile) fail('Student profile is unavailable for score persistence.', 409);
      await database.execute('INSERT INTO academic_score_records (id,school_id,record_type,mock_label,academic_year_id,term_id,class_id,student_id,subject_id,ca_score,ca_max,examination_score,examination_max,total_score,grade,remark,entered_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [scoreId, schoolId, 'MOCK', mockLabel, period.yearId, period.termId, classId, profile.id, subjectId, 0, 0, totalScore, 100, totalScore, grade, remark, actor.id, clock()]);
    }
    return { id: scoreId, schoolId, studentId, permanentStudentId: enrolled.permanent_student_id, classId, subjectId, mockLabel, academicYear: period.yearName, term: period.termName, caScore: null, examScore: null, totalScore, grade, remark, saved: true };
  }

  async function listScores(input = {}, actor, { mock = false } = {}) {
    assertActor(actor);
    if (!authorized(actor, mock ? 'mock.scores.read' : 'results.read') && !authorized(actor, mock ? 'mock.scores.write' : 'marks.write')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId), studentId = text(input.studentId), subjectId = text(input.subjectId);
    const academicYear = text(input.academicYearId || input.academicYear), term = text(input.termId || input.term);
    if (!academicYear || !term) return [];
    const period = await resolvePeriod(input);
    const conditions = ['r.school_id=?', 'r.record_type=?', 'r.academic_year_id=?', 'r.term_id=?'];
    const params = [schoolId, mock ? 'MOCK' : 'TERMINAL', period.yearId, period.termId];
    if (classId) { conditions.push('r.class_id=?'); params.push(classId); }
    if (studentId) { conditions.push('(s.id=? OR s.permanent_student_id=? OR sp.student_master_id=?)'); params.push(studentId, studentId, studentId); }
    if (subjectId) { conditions.push('r.subject_id=?'); params.push(subjectId); }
    if (mock) { conditions.push('r.mock_label=?'); params.push(text(input.mockLabel)); }
    else conditions.push('r.mock_label IS NULL');
    const result = await database.query(`SELECT r.id,r.school_id AS schoolId,sp.student_master_id AS studentId,s.permanent_student_id AS permanentStudentId,r.class_id AS classId,r.subject_id AS subjectId,r.record_type AS recordType,r.mock_label AS mockLabel,r.ca_score AS caScore,r.examination_score AS examScore,r.total_score AS totalScore,r.grade,r.remark,r.updated_at AS updatedAt
      FROM academic_score_records r JOIN student_profiles sp ON sp.id=r.student_id AND sp.school_id=r.school_id JOIN students s ON (sp.student_master_id=s.id OR sp.student_id=s.permanent_student_id) AND s.school_id=r.school_id
      WHERE ${conditions.join(' AND ')} ORDER BY s.last_name,s.first_name,s.id,r.subject_id`, params);
    return rows(result).map((item) => ({ ...item, caScore: item.caScore == null ? null : Number(item.caScore), examScore: item.examScore == null ? null : Number(item.examScore), totalScore: item.totalScore == null ? null : Number(item.totalScore) }));
  }

  async function canonicalResult(input = {}, actor, { mock = false } = {}) {
    assertActor(actor);
    if (!authorized(actor, mock ? 'mock.results.read' : 'results.read') && !authorized(actor, mock ? 'mock.results.generate' : 'results.generate')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId), studentId = text(input.studentId), mockLabel = mock ? text(input.mockLabel) : null;
    if (!classId || !studentId) fail('Class and student are required.');
    if (mock) await assertMockClass(classId);
    const period = await resolvePeriod(input);
    await classFor(classId);
    const studentQuery = `SELECT s.id,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname,s.gender,e.class_id AS classId
      FROM students s JOIN student_enrollments e ON e.student_id=s.id AND e.school_id=s.school_id
      WHERE s.school_id=? AND s.id=? AND e.class_id=? AND e.academic_year_id=? AND e.term_id=?`;
    const studentParams = [schoolId, studentId, classId, period.yearId, period.termId];
    let studentRows;
    try {
      studentRows = await database.query(`${studentQuery} AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,1)=1 LIMIT 1`, studentParams);
    } catch (error) {
      if (!schemaCompatibilityError(error)) throw error;
      studentRows = await database.query(`${studentQuery} LIMIT 1`, studentParams);
    }
    const student = rows(studentRows)[0];
    if (!student) fail('Student is not enrolled in the selected academic context.', 404);
    const scoreRows = rows(await database.query(`SELECT r.subject_id AS subjectId,sub.name AS subjectName,r.ca_score AS caScore,r.examination_score AS examScore,r.total_score AS totalScore,r.updated_at AS updatedAt
      FROM academic_score_records r JOIN student_profiles sp ON sp.id=r.student_id AND sp.school_id=r.school_id JOIN subjects sub ON sub.id=r.subject_id AND sub.school_id=r.school_id
      WHERE r.school_id=? AND (sp.student_master_id=? OR sp.student_id=?) AND r.class_id=? AND r.academic_year_id=? AND r.term_id=? AND r.record_type=? AND ((r.mock_label IS NULL AND ? IS NULL) OR r.mock_label=?) ORDER BY sub.name,sub.id`, [schoolId, student.id, student.permanentStudentId, classId, period.yearId, period.termId, mock ? 'MOCK' : 'TERMINAL', mockLabel, mockLabel]));
    const subjects = scoreRows.map((row) => { const totalScore = Number(row.totalScore); const [grade, remark] = gradeForTotal(totalScore, { classId, examination: mock ? 'MOCK' : 'TERMINAL' }); return { ...row, caScore: Number(row.caScore), examScore: Number(row.examScore), totalScore, grade, remark, submitted: true }; });
    const canonical = calculateStudentResult(subjects, { classId, examination: mock ? 'MOCK' : 'TERMINAL' });
    const lifecycle = rows(await database.query(`SELECT id,attendance_json AS attendanceJson,assessment_json AS assessmentJson,status,version,saved_at AS savedAt,updated_at AS updatedAt,published_at AS publishedAt
      FROM academic_result_records WHERE school_id=? AND student_id=? AND class_id=? AND academic_year_id=? AND term_id=? AND examination=? AND ((mock_label IS NULL AND ? IS NULL) OR mock_label=?) LIMIT 1`, [schoolId, student.id, classId, period.yearId, period.termId, mock ? 'MOCK' : 'TERMINAL', mockLabel, mockLabel]))[0];
    const decode = (value) => { if (!value) return null; if (typeof value === 'object') return value; try { return JSON.parse(value); } catch { return null; } };
    const resolvedSignatures = signatures?.resolveForStudent?.(student, { academicYear: period.yearName, term: period.termName });
    return { headerAsset: '/assets/osaah-result-header.png', resultType: mock ? 'MOCK' : 'TERMINAL', studentId: student.id, studentIndexNumber: student.permanentStudentId, studentName: [student.firstName, student.middleName, student.surname].filter(Boolean).join(' '), gender: student.gender ?? null, classId, academicYear: period.yearName, term: period.termName, mockLabel, subjects, totalScore: canonical.totalScore, average: canonical.average ?? 0, percentage: canonical.percentage, subjectsSat: canonical.subjectsSat, totalMaximum: canonical.totalMaximum, aggregateMaximum: canonical.aggregateMaximum, aggregateStatus: canonical.aggregateStatus, aggregate: canonical.aggregate, aggregateSubjects: canonical.aggregateSubjects.map((row) => row.subjectId), grade: gradeForTotal(canonical.average ?? 0, { classId, examination: mock ? 'MOCK' : 'TERMINAL' })[0], remark: gradeForTotal(canonical.average ?? 0, { classId, examination: mock ? 'MOCK' : 'TERMINAL' })[1], attendance: decode(lifecycle?.attendanceJson), assessment: decode(lifecycle?.assessmentJson), signatures: [{ signatoryRole: 'CLASS_TEACHER', name: resolvedSignatures?.classTeacher?.name, ...(resolvedSignatures?.classTeacher?.signature ?? {}) }, { signatoryRole: 'HEADTEACHER', name: resolvedSignatures?.headteacher?.name, ...(resolvedSignatures?.headteacher?.signature ?? {}) }].filter((item) => item.id), lifecycle: lifecycle ? { status: lifecycle.status, dirty: false, version: Number(lifecycle.version), savedAt: lifecycle.savedAt, publishedAt: lifecycle.publishedAt } : { status: 'UNSAVED/INCOMPLETE', dirty: true, version: 0, savedAt: null }, isSample: false };
  }

  async function saveResult(input = {}, actor) {
    assertActor(actor);
    if (!authorized(actor, 'results.write') && !authorized(actor, 'marks.write')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const result = await canonicalResult(input, { ...actor, permissions: new Set(['results.read', 'results.generate']) });
    const attendance = input.attendance ?? {}, assessment = input.assessment ?? {};
    for (const key of ['timesPresent', 'timesAbsent', 'totalSchoolDays']) if (!Number.isFinite(Number(attendance[key])) || Number(attendance[key]) < 0) fail(`${key} has not been captured.`);
    for (const key of ['conduct', 'attitude', 'interest', 'classTeacherRemarks', 'headteacherRemarks']) if (!text(assessment[key])) fail(`${key} has not been selected.`);
    const existing = rows(await database.query(`SELECT id,version FROM academic_result_records WHERE school_id=? AND student_id=? AND class_id=? AND academic_year_id=? AND term_id=? AND examination=? AND ((mock_label IS NULL AND ? IS NULL) OR mock_label=?) LIMIT 1`, [schoolId, result.studentId, result.classId, (await resolvePeriod(input)).yearId, (await resolvePeriod(input)).termId, result.resultType, result.mockLabel, result.mockLabel]))[0];
    const period = await resolvePeriod(input), id = existing?.id ?? idFactory(), now = clock(), version = Number(existing?.version ?? 0) + 1;
    if (existing) await database.execute('UPDATE academic_result_records SET attendance_json=?,assessment_json=?,status="SAVED",version=?,saved_by=?,saved_at=?,updated_at=? WHERE id=? AND school_id=?', [JSON.stringify(attendance), JSON.stringify(assessment), version, actor.id, now, now, id, schoolId]);
    else await database.execute('INSERT INTO academic_result_records (id,school_id,student_id,class_id,academic_year_id,term_id,examination,mock_label,attendance_json,assessment_json,status,version,saved_by,saved_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, schoolId, result.studentId, result.classId, period.yearId, period.termId, result.resultType, result.mockLabel, JSON.stringify(attendance), JSON.stringify(assessment), 'SAVED', version, actor.id, now, now]);
    return { ...result, attendance, assessment, lifecycle: { status: 'SAVED', dirty: false, version, savedAt: now } };
  }

  async function publishResult(input = {}, actor) {
    assertActor(actor, 'results.publish');
    const period = await resolvePeriod(input);
    const result = await canonicalResult(input, { ...actor, permissions: new Set(['results.read', 'results.generate']) });
    const record = rows(await database.query('SELECT id,status,version FROM academic_result_records WHERE school_id=? AND student_id=? AND class_id=? AND academic_year_id=? AND term_id=? AND examination=? AND ((mock_label IS NULL AND ? IS NULL) OR mock_label=?) LIMIT 1', [schoolId, result.studentId, result.classId, period.yearId, period.termId, result.resultType, result.mockLabel, result.mockLabel]))[0];
    if (!record || record.status !== 'SAVED') fail('Save this result before publishing.');
    await database.execute('UPDATE academic_result_records SET status="PUBLISHED",published_by=?,published_at=?,updated_at=? WHERE id=? AND school_id=?', [actor.id, clock(), clock(), record.id, schoolId]);
    return { id: record.id, schoolId, classId: result.classId, academicYear: result.academicYear, term: result.term, examination: result.resultType, mockLabel: result.mockLabel, status: 'PUBLISHED', studentId: result.studentId, isSample: false };
  }

  async function publicationFor(input = {}, actor) {
    assertActor(actor);
    const period = await resolvePeriod(input);
    return rows(await database.query('SELECT id,school_id AS schoolId,class_id AS classId,academic_year_id AS academicYearId,term_id AS termId,examination,mock_label AS mockLabel,status,student_id AS studentId,published_at AS publishedAt FROM academic_result_records WHERE school_id=? AND student_id=? AND class_id=? AND academic_year_id=? AND term_id=? AND examination=? AND status="PUBLISHED" AND ((mock_label IS NULL AND ? IS NULL) OR mock_label=?) LIMIT 1', [schoolId, input.studentId, input.classId, period.yearId, period.termId, input.examination === 'MOCK' ? 'MOCK' : 'TERMINAL', input.mockLabel ?? null, input.mockLabel ?? null]))[0] ?? null;
  }

  async function broadsheet(input = {}, actor, { mock = false } = {}) {
    assertActor(actor);
    if (!authorized(actor, mock ? 'mock.results.read' : 'results.read')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId);
    const period = await resolvePeriod(input);
    const students = rows(await database.query(`SELECT DISTINCT s.id AS studentId,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname
      FROM students s JOIN student_enrollments e ON e.student_id=s.id AND e.school_id=s.school_id
      WHERE s.school_id=? AND e.class_id=? AND e.academic_year_id=? AND e.term_id=? AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,1)=1 AND COALESCE(s.is_test_record,0)=0 ORDER BY s.last_name,s.first_name,s.id`, [schoolId, classId, period.yearId, period.termId]));
    return Promise.all(students.map(async (student) => {
      const result = await canonicalResult({ ...input, studentId: student.studentId, classId, academicYear: period.yearId, term: period.termId }, actor, { mock });
      const subjectTotals = Object.fromEntries(result.subjects.map((row) => [row.subjectName, row.totalScore]));
      return { studentId: result.studentId, permanentStudentId: result.studentIndexNumber, studentName: result.studentName, classId, subjectTotals, totalScore: result.totalScore, aggregate: result.aggregate, averageScore: result.average, percentage: result.percentage, classPosition: result.classPosition ?? '—', isSample: false };
    }));
  }

  return Object.freeze({ options, listSubjects, subjectCatalog, subjectConfiguration, createSubject, updateSubject, deactivateSubject, subjectCascade, configureDefaultSubjects, listAssignments, assignSubject, deactivateSubjectAssignment, roster, resultStudents, resultContext, saveScore, mockRoster, saveMockScore, listScores, resolvePeriod, result: canonicalResult, saveResult, publishResults: publishResult, publicationFor, savedResultFor: async (input, actor) => canonicalResult(input, actor), broadsheet });
}

export default createDurableAcademicService;
