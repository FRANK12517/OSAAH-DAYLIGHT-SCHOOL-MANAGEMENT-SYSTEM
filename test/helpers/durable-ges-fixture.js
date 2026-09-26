import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

export const schoolId = 'sch_default_01';
export const context = Object.freeze({ studentId: 'student-a', classId: 'class-a', academicYear: '2026/2027', term: 'First Term' });
export const teacher = Object.freeze({ id: 'teacher-a', schoolId, roleKey: 'TEACHER', permissions: new Set(['marks.write', 'results.read', 'results.generate']), assignedClassIds: ['class-a'], assignedSubjectIds: ['subject-a'] });

export async function durableGesFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE schools(id VARCHAR(191) PRIMARY KEY);
    CREATE TABLE levels(id VARCHAR(191) PRIMARY KEY,school_id VARCHAR(191),name TEXT,display_order INTEGER);
    CREATE TABLE classes(id VARCHAR(191) PRIMARY KEY,school_id VARCHAR(191),level_id VARCHAR(191),name TEXT,display_order INTEGER);
    CREATE TABLE academic_years(id VARCHAR(191) PRIMARY KEY,school_id VARCHAR(191),name TEXT,starts_on TEXT,ends_on TEXT,is_current INTEGER);
    CREATE TABLE terms(id VARCHAR(191) PRIMARY KEY,academic_year_id VARCHAR(191),name TEXT,starts_on TEXT,ends_on TEXT,is_current INTEGER);
    CREATE TABLE subjects(id VARCHAR(191) PRIMARY KEY,school_id VARCHAR(191),name TEXT);
    CREATE TABLE class_subjects(id VARCHAR(191) PRIMARY KEY,class_id VARCHAR(191),subject_id VARCHAR(191),teacher_id VARCHAR(191));
    CREATE TABLE students(id VARCHAR(191) PRIMARY KEY,school_id VARCHAR(191),permanent_student_id VARCHAR(191),first_name TEXT,middle_name TEXT,last_name TEXT,gender TEXT,is_test_record INTEGER,current_class_id VARCHAR(191));
    CREATE TABLE student_enrollments(id VARCHAR(191) PRIMARY KEY,student_id VARCHAR(191),class_id VARCHAR(191),academic_year_id VARCHAR(191));
    CREATE TABLE academic_score_records(id VARCHAR(191) PRIMARY KEY,student_id VARCHAR(191),score DECIMAL(6,2));
    INSERT INTO academic_score_records VALUES('legacy-score','legacy-profile',72);
    INSERT INTO schools VALUES('${schoolId}'),('school-b');
    INSERT INTO levels VALUES('level-a','${schoolId}','PRIMARY',1),('level-b','school-b','PRIMARY',1);
    INSERT INTO classes VALUES('class-a','${schoolId}','level-a','Basic 4',4),('class-next','${schoolId}','level-a','Basic 5',5),('foreign-class','school-b','level-b','Basic 4',4);
    INSERT INTO academic_years VALUES('year-a','${schoolId}','2026/2027','','',1),('year-old','${schoolId}','2025/2026','','',0),('year-b','school-b','2026/2027','','',1);
    INSERT INTO terms VALUES('term-first','year-a','First Term','','',1),('term-second','year-a','Second Term','','',0),('term-old','year-old','First Term','','',0),('term-foreign','year-b','First Term','','',1);
    INSERT INTO subjects VALUES('subject-a','${schoolId}','English Language'),('subject-b','school-b','English Language');
    INSERT INTO class_subjects VALUES('mapping-a','class-a','subject-a','teacher-a');
    INSERT INTO students VALUES('student-a','${schoolId}','OSAAH/2026/0001','Ama','Akua','Mensah','Female',0,'class-next'),('student-b','${schoolId}','OSAAH/2026/0002','Kojo',NULL,'Boateng','Male',0,'class-a'),('foreign-student','school-b','OSAAH/2026/9001','Foreign',NULL,'Student','Male',0,'foreign-class'),('TEST-OSAAH-0001','${schoolId}','TEST-OSAAH-0001','Sample',NULL,'Learner','Female',1,'class-a');
    INSERT INTO student_enrollments VALUES('enroll-a','student-a','class-a','year-a'),('enroll-old','student-a','class-a','year-old'),('enroll-next','student-a','class-next','year-a'),('enroll-b','student-b','class-a','year-a'),('enroll-foreign','foreign-student','foreign-class','year-b'),('enroll-test','TEST-OSAAH-0001','class-a','year-a');`);
  const migration055 = await readFile(new URL('../../schema/055_canonical_academic_scores.sql', import.meta.url), 'utf8');
  const migration056 = await readFile(new URL('../../schema/056_canonical_ges_assessments.sql', import.meta.url), 'utf8');
  const database = {
    async query(sql, params = []) { try { return db.prepare(sql).all(...params); } catch (error) { if (/no such table/i.test(error.message)) error.code = 'ER_NO_SUCH_TABLE'; else if (/no such column/i.test(error.message)) error.code = 'ER_BAD_FIELD_ERROR'; throw error; } },
    async execute(sql, params = []) { return db.prepare(sql).run(...params); },
    async transaction(work) { db.exec('BEGIN'); try { const result = await work(database); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  };
  const migrate = () => { db.exec(migration055); db.exec(migration056); };
  return { db, database, migration055, migration056, migrate };
}
