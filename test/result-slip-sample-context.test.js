import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';
import { createDurableAcademicService } from '../src/durable-academic.js';
import { createSampleResultWorkflow } from '../src/sample-result-workflow.js';
import { createAcademicResultsService } from '../src/academic-results.js';
import { createStudentService } from '../src/students.js';
import { createSubjectService } from '../src/subjects.js';
import { calculateStudentResult } from '../src/result-calculation.js';
import { gradeForTotal } from '../src/grading.js';
import { createApp } from '../src/server.mjs';
const { DatabaseSync } = await import('node:sqlite').catch(() => ({}));
const sqlTest = (name, fn) => test(name, { skip: !DatabaseSync && 'SQL integration requires Node 22+' }, fn);
const schoolId = 'sch_default_01';
const actor = { id: 'head', schoolId, portal: 'school', roleKey: 'HEADTEACHER', permissions: new Set(['*']) };
const classes = [ ['Nursery','Nursery 1','NURSERY'], ['KG 1','KG1','KG'], ['KG 2','KG2','KG'], ...[1,2,3,4,5,6].map(n => [`Basic ${n}`,`Primary ${n}`, n < 4 ? 'LOWER_PRIMARY' : 'UPPER_PRIMARY']), ...[1,2,3].map(n => [`JHS ${n}`,`JHS ${n}`,'JHS']) ].map(([name, legacy, level], i) => ({ id: `db-class-${i}`, name, legacy, level }));
// Database configuration fixtures, not a second application subject library.
const groups = { NURSERY: ['Nursery Language','Nursery Number Work'], KG: ['KG Literacy','KG Numeracy','Creative Arts'], LOWER_PRIMARY: ['English Language','Mathematics','Science','History','RME','Creative Arts'], UPPER_PRIMARY: ['English Language','Mathematics','Science','History','Computing','French'], JHS: ['English Language','Mathematics','Science','Social Studies','RME','Fantse','Computing','French'] };
const input = (index = 0) => ({ classId: classes[index].id, academicYear: '2026/2027', term: 'First Term' });
function fixture(legacySubjects = false) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE classes(id TEXT,name TEXT,school_id TEXT,level TEXT,department_id TEXT,created_at TEXT);
    CREATE TABLE academic_years(id TEXT,school_id TEXT,name TEXT,starts_on TEXT,ends_on TEXT,is_current INTEGER);
    CREATE TABLE terms(id TEXT,academic_year_id TEXT,name TEXT,starts_on TEXT,ends_on TEXT,is_current INTEGER);
    CREATE TABLE subjects(id TEXT,school_id TEXT,name TEXT,code TEXT,department_id TEXT,status TEXT);
    ${legacySubjects ? 'CREATE TABLE class_subjects(id TEXT,class_id TEXT,subject_id TEXT,school_id TEXT,academic_year_id TEXT,term_id TEXT,status TEXT);' : 'CREATE TABLE subject_class_assignments(id TEXT,school_id TEXT,subject_id TEXT,class_id TEXT,academic_year_id TEXT,active INTEGER);'}
    INSERT INTO academic_years VALUES('year-a','${schoolId}','2026/2027','','',1),('year-x','other','2026/2027','','',1);
    INSERT INTO terms VALUES('term-a','year-a','First Term','','',1),('term-b','year-a','Second Term','','',0),('term-x','year-x','Foreign','','',1);
    INSERT INTO classes VALUES('foreign-class','JHS 3','other','JHS',NULL,NULL);`);
  for (const c of classes) {
    db.prepare('INSERT INTO classes(id,name,school_id,level) VALUES(?,?,?,?)').run(c.id,c.name,schoolId,c.level);
    groups[c.level].forEach((name, n) => {
      const id = `${c.id}-subject-${n}`;
      db.prepare('INSERT INTO subjects VALUES(?,?,?,?,?,?)').run(id,schoolId,name,`S${n}`,null,'ACTIVE');
      if (legacySubjects) db.prepare('INSERT INTO class_subjects VALUES(?,?,?,?,?,?,?)').run(`a-${id}`,c.id,id,schoolId,'year-a',null,'ACTIVE');
      else db.prepare('INSERT INTO subject_class_assignments VALUES(?,?,?,?,?,?)').run(`a-${id}`,schoolId,id,c.id,'year-a',1);
    });
  }
  const calls = []; let writes = 0;
  const database = { async query(sql, params = []) { calls.push({ sql, params }); if (sql.startsWith('SHOW COLUMNS FROM ')) return db.prepare(`PRAGMA table_info(${sql.split(' ').at(-1)})`).all().map(row => ({ Field: row.name })); try { return db.prepare(sql).all(...params); } catch (error) { if (/no such table/.test(error.message)) error.code = 'ER_NO_SUCH_TABLE'; else if (/no such column/.test(error.message)) error.code = 'ER_BAD_FIELD_ERROR'; throw error; } }, execute() { writes++; throw Error('Sample must not write to database'); } };
  const students = createStudentService({ schoolId });
  const real = students.createStudent({ firstName: 'Real', surname: 'Student', classId: 'Primary 1', admissionYearId: '2026' });
  const subjects = createSubjectService({ schoolId });
  const results = createAcademicResultsService({ schoolId, students, subjects });
  results.saveScore({ studentId: real.id, classId: 'Primary 1', subjectId: subjects.list({},actor)[0].id, academicYear: '2026/2027', term: 'First Term', caScore: 40, examScore: 45 }, actor);
  const durable = createDurableAcademicService({ database, schoolId });
  const workflow = createSampleResultWorkflow({ students, subjects, academicResults: results, schoolId, resolveContext: durable.sampleContext });
  return { db, database, calls, writes: () => writes, students, subjects, results, workflow, durable, real };
}

for (const [index,c] of classes.entries()) sqlTest(`${c.name}: canonical class selects ${c.level} subjects and preserves existing CA/Exam/grade calculations`, async () => {
  const f = fixture();
  try {
    const r = await f.workflow.generateForContext(input(index), actor);
    assert.equal(r.classId,c.id); assert.equal(r.className,c.name); assert.equal(r.sampleLevel,c.level);
    assert.equal(r.isSample,true); assert.equal(r.isPreview,true);
    assert.match(r.studentId,/^TEST-OSAAH-/); assert.match(r.studentIndexNumber,/^TEST-OSAAH-/);
    assert.equal(r.studentId,r.studentIndexNumber);
    assert.deepEqual(new Set(r.subjects.map(s => s.subjectName)), new Set(groups[c.level]));
    for (const row of r.subjects) {
      assert.equal(row.classId,c.id); assert.equal(row.caMax,50); assert.equal(row.examMax,50);
      assert.ok(row.caScore >= 0 && row.caScore <= 50); assert.ok(row.examScore >= 0 && row.examScore <= 50);
      assert.equal(row.totalScore,row.caScore+row.examScore);
      assert.equal(row.grade,gradeForTotal(row.totalScore,{classId:c.legacy})[0]);
    }
    const calculated = JSON.parse(JSON.stringify(calculateStudentResult(r.subjects,{classId:c.legacy})));
    assert.equal(r.totalScore,calculated.totalScore); assert.equal(r.aggregate,calculated.aggregate);
    assert.equal(Object.keys(r.assessments).length,5); assert.ok(r.classPosition); assert.ok(r.attendance.totalSchoolDays > 0);
    if (['NURSERY','KG','UPPER_PRIMARY'].includes(c.level)) assert.equal(r.aggregate,null);
    const repeated = await f.workflow.generateForContext(input(index), actor);
    assert.deepEqual(repeated.subjects.map(s=>[s.subjectId,s.totalScore]),r.subjects.map(s=>[s.subjectId,s.totalScore]));
    assert.equal(f.writes(),0);
  } finally { f.db.close(); }
});

sqlTest('legacy subject mapping discovers columns and excludes foreign/inactive/year/term configuration', async () => {
  const f = fixture(true);
  try {
    f.db.exec("INSERT INTO subjects VALUES('foreign-subject','other','Foreign secret','X',NULL,'ACTIVE'); INSERT INTO class_subjects VALUES('x','db-class-0','foreign-subject','sch_default_01','year-a',NULL,'ACTIVE'); UPDATE class_subjects SET term_id='term-b' WHERE subject_id='db-class-0-subject-1'");
    const r = await f.workflow.generateForContext(input(),actor);
    assert.deepEqual(r.subjects.map(s=>s.subjectName),['Nursery Language']);
    assert.ok(f.calls.some(c=>c.sql==='SHOW COLUMNS FROM class_subjects'));
    assert.ok(f.calls.some(c=>c.sql==='SHOW COLUMNS FROM subjects'));
    f.db.exec("UPDATE class_subjects SET status='INACTIVE'");
    await assert.rejects(f.workflow.generateForContext(input(),actor), { status:404 });
  } finally { f.db.close(); }
});

sqlTest('missing subjects do not fall back to another class or a generic subject library', async () => {
  const f=fixture(); try { f.db.exec("DELETE FROM subject_class_assignments WHERE class_id='db-class-0'"); await assert.rejects(f.workflow.generateForContext(input(),actor),{status:404}); } finally {f.db.close();}
});

sqlTest('canonical record controls classification; arbitrary labels and school parameters cannot override it', async () => {
  const f=fixture(); try {
    const r=await f.workflow.generateForContext({...input(11), className:'KG 1',schoolId:'other', studentId:f.real.id, permanentStudentId:f.real.permanentStudentId},actor);
    assert.equal(r.sampleLevel,'JHS'); assert.equal(r.schoolId,schoolId); assert.notEqual(r.studentId,f.real.id);
    await assert.rejects(f.workflow.generateForContext({...input(),classId:'Primary 1'},actor),{status:403});
    await assert.rejects(f.workflow.generateForContext({...input(),classId:'foreign-class'},actor),{status:403});
    await assert.rejects(f.workflow.generateForContext(input(),{...actor,schoolId:'other'}),{status:403});
    await assert.rejects(f.workflow.generateForContext({...input(),term:'term-x'},actor),{status:404});
    const teacher={...actor,roleKey:'TEACHER',assignedClassIds:[classes[0].id],permissions:new Set(['results.generate'])};
    assert.equal((await f.workflow.generateForContext(input(),teacher)).classId,classes[0].id);
    await assert.rejects(f.workflow.generateForContext(input(1),teacher),{status:403});
  } finally {f.db.close();}
});

sqlTest('sample loads cannot change students, IDs, scores, results, ranking, broadsheets or shared academic audit', async () => {
  const f=fixture(); try {
    const snapshot=()=>JSON.stringify({students:f.students.listStudents({requestedSchoolId:schoolId,includeTestRecords:true}), scores:f.results.listScores({},actor), result:f.results.result({classId:'Primary 1',studentId:f.real.id,academicYear:'2026/2027',term:'First Term'},actor),broadsheet:f.results.broadsheet({classId:'Primary 1',academicYear:'2026/2027',term:'First Term'},actor,{mock:false}),audit:f.results.auditTrail()});
    const before=snapshot(); await f.workflow.generateForContext(input(3),actor); assert.equal(snapshot(),before);
    assert.equal(f.writes(),0);
    assert.ok(f.calls.every(c=>!/(students|student_enrollments|student_id_sequences|academic_score_records)/.test(c.sql)));
    const next=f.students.createStudent({firstName:'Next',surname:'Real',classId:'Primary 1',admissionYearId:'2026'});
    assert.equal(next.permanentStudentId,'OSAAH/2026/0002');
  } finally {f.db.close();}
});

async function apiFixture(f, fn) {
  let sends=0;
  const auth={authenticateAsync:async token=>token==='ok'?actor:token==='denied'?{...actor,roleKey:'ACCOUNTANT_BURSAR',permissions:new Set(['students.read'])}:token==='other'?{...actor,schoolId:'other'}:null};
  const app=createApp({auth,database:f.database,students:f.students,subjects:f.subjects,academicResults:f.results,communicationEngine:{enqueue(){sends++;},async process(){sends++;}}});
  const server=http.createServer((req,res)=>Promise.resolve(app(req,res)).catch(()=>{res.writeHead(500);res.end('{}');}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const request=(path,body,token='ok')=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  try {await fn(request,()=>sends);}finally{await new Promise(resolve=>server.close(resolve));}
}

sqlTest('sample endpoint loads without a real student, keeps 401/403, and exports with existing PDF service',async()=>{
 const f=fixture();try{await apiFixture(f,async(request)=>{
  assert.equal((await request('/api/academic/sample/generate',input(),'missing')).status,401);
  for(const token of ['denied','other']) assert.equal((await request('/api/academic/sample/generate',input(),token)).status,403);
  const response=await request('/api/academic/sample/generate',input());assert.equal(response.status,201);const r=(await response.json()).result;assert.equal(r.classId,classes[0].id);
  const pdf=await request('/api/academic/result/pdf?'+new URLSearchParams({...input(),studentId:r.studentId,sample:'true'}));assert.equal(pdf.status,200);assert.match(pdf.headers.get('content-type'),/application\/pdf/);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
 });}finally{f.db.close();}
});

sqlTest('production score/save/publish routes reject sample flags or reserved identities, with zero SMS or notifications',async()=>{
 const f=fixture();try{await apiFixture(f,async(request,sends)=>{
  const r=(await (await request('/api/academic/sample/generate',input(3))).json()).result;
  const before=JSON.stringify(f.results.auditTrail());
  for(const path of ['/api/academic/scores','/api/academic/mock-scores','/api/academic/results/save','/api/academic/results/publish']){
   for(const body of [{...input(3),studentId:r.studentId},{...input(3),studentId:f.real.id,isSample:true},{...input(3),studentId:f.real.id,permanentStudentId:r.permanentStudentId}]) assert.equal((await request(path,body)).status,403,path);
  }
  assert.equal((await request('/api/academic/sample/publish',{...input(3),permanentStudentId:r.permanentStudentId})).status,409);
  assert.equal(JSON.stringify(f.results.auditTrail()),before);assert.equal(sends(),0);assert.equal(f.writes(),0);
 });}finally{f.db.close();}
});

sqlTest('missing sample configuration and database outage produce safe, distinct errors',async()=>{
 const f=fixture();try{await apiFixture(f,async(request)=>{
  f.db.exec("DELETE FROM subject_class_assignments WHERE class_id='db-class-0'");const absent=await request('/api/academic/sample/generate',input());assert.equal(absent.status,404);assert.equal((await absent.json()).error,'Sample result is unavailable for the selected class.');
  f.database.query=async()=>{throw Error('private SQL details');};const failed=await request('/api/academic/sample/generate',input());assert.equal(failed.status,500);assert.equal((await failed.json()).error,'Unable to load sample result. Please try again.');
 });}finally{f.db.close();}
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function element(value=''){return {value,disabled:false,hidden:false,textContent:'',handlers:{},_html:'',addEventListener(event,fn){this.handlers[event]=fn;},set innerHTML(html){this._html=html;this.value=/<option value="([^"]*)"/.exec(html)?.[1]??'';},get innerHTML(){return this._html;}};}
async function browser(sampleResponse=async body=>({ok:true,json:async()=>({result:{isSample:true,isPreview:true,classId:body.classId,subjects:[],className:'Sample Class',studentName:'Sample Student',studentIndexNumber:'TEST-OSAAH-N1-001'}})})){
 const fields={academicYear:element('2026/2027'),term:element('First Term'),classId:element(),studentId:element(),permanentStudentId:element(),sampleMode:{...element(),checked:false}};
 const host=element(),status=element(),button=element(),retry=element(),retryStudents=element(),retryResult=element(),years=element();const form={...element(),elements:fields,querySelector:()=>button};
 host.querySelector=()=>({...element(),dataset:{}});host.querySelectorAll=()=>[];
 const requests=[];const ctx=vm.createContext({document:{querySelector:selector=>({'#result-context':form,'#result':host,'#status':status,'#retry-options':retry,'#retry-students':retryStudents,'#retry-result':retryResult,'#result-academic-years':years})[selector]},localStorage:{getItem:()=>null},window:{},URLSearchParams,AbortController,setTimeout,clearTimeout,FormData:class{constructor(){return Object.entries(fields).filter(([key])=>key!=='sampleMode').map(([key,value])=>[key,value.value]);}},fetch:async(url,init)=>{
 requests.push({url,init});if(url==='/api/academic/options')return {ok:true,json:async()=>({classes:classes.map(c=>({id:c.id,name:c.name}))})};if(url.startsWith('/api/academic/result-students?'))return {ok:true,json:async()=>({students:[]})};if(url==='/api/academic/sample/generate')return sampleResponse(JSON.parse(init.body),init);return {ok:true,json:async()=>({result:{subjects:[]}})};
 }});vm.runInContext(readFileSync(new URL('../public/result-view.js',import.meta.url),'utf8'),ctx);await tick();fields.classId.value=classes[0].id;await fields.classId.handlers.change();
 return {ctx,fields,host,status,button,form,requests,retryResult,toggle(on){fields.sampleMode.checked=on;fields.sampleMode.handlers.change();},submit(){return form.handlers.submit({preventDefault(){}});}};
}

test('Test Mode enables Load Result without a student and sends only the selected academic context',async()=>{
 const page=await browser();assert.equal(page.button.disabled,true);page.toggle(true);assert.equal(page.button.disabled,false);assert.equal(page.fields.studentId.required,false);assert.equal(page.fields.studentId.disabled,true);
 await page.submit();const post=page.requests.find(r=>r.url==='/api/academic/sample/generate');assert.deepEqual(JSON.parse(post.init.body),{...input(),examinationType:'TERMINAL'});
 assert.match(page.host.innerHTML,/SAMPLE DATA/);assert.match(page.host.innerHTML,/GES Teacher Assessment/);assert.match(page.host.innerHTML,/Attendance/);assert.match(page.host.innerHTML,/Class Teacher Signature/);assert.match(page.host.innerHTML,/EXPORT \/ DOWNLOAD PDF/);assert.match(page.host.innerHTML,/id="save-result"[^>]*disabled/);assert.doesNotMatch(page.host.innerHTML,/id="publish-sample"/);
});

for(const [field,value] of [['classId',classes[11].id],['academicYear','2027/2028'],['term','Second Term']])test(`active sample ${field} change clears old rendering and preserves explicit Test Mode`,async()=>{
 const page=await browser();page.toggle(true);await page.submit();assert.equal(page.host.hidden,false);page.fields[field].value=value;await page.fields[field].handlers.change();assert.equal(page.host.hidden,true);assert.equal(page.host.innerHTML,'');assert.equal(page.fields.sampleMode.checked,true);await page.submit();const sent=JSON.parse(page.requests.at(-1).init.body);assert.equal(sent[field],value);
});

test('Test Mode off removes sample state and restores the durable real-student workflow',async()=>{
 const page=await browser();page.toggle(true);await page.submit();page.toggle(false);assert.equal(page.host.hidden,true);assert.equal(page.host.innerHTML,'');assert.equal(page.fields.studentId.required,true);assert.equal(page.button.disabled,true);assert.equal(page.fields.classId.value,classes[0].id);assert.equal(page.fields.academicYear.value,'2026/2027');
 vm.runInContext("options.students = [{id:'durable-real',classId:form.elements.classId.value,permanentStudentId:'OSAAH/2026/0001',name:'Real Student'}]",page.ctx);page.fields.studentId.value='durable-real';page.fields.studentId.handlers.change();await page.submit();assert.match(page.requests.at(-1).url,/^\/api\/academic\/result\?/);
});

test('late old-class sample response cannot overwrite the newly selected class',async()=>{
 const a=deferred(),b=deferred();const page=await browser(body=>body.classId===classes[0].id?a.promise:b.promise);page.toggle(true);const first=page.submit();const firstSignal=page.requests.at(-1).init.signal;page.fields.classId.value=classes[11].id;await page.fields.classId.handlers.change();const second=page.submit();assert.equal(firstSignal.aborted,true);
 b.resolve({ok:true,json:async()=>({result:{isSample:true,isPreview:true,classId:classes[11].id,className:'JHS 3',subjects:[]}})});await second;a.resolve({ok:true,json:async()=>({result:{isSample:true,classId:classes[0].id,className:'OLD CLASS',subjects:[]}})});await first;assert.match(page.host.innerHTML,/JHS 3/);assert.doesNotMatch(page.host.innerHTML,/OLD CLASS/);
});

test('turning Test Mode off during a sample load invalidates its response',async()=>{
 const pending=deferred();const page=await browser(()=>pending.promise);page.toggle(true);const loading=page.submit();page.toggle(false);pending.resolve({ok:true,json:async()=>({result:{isSample:true,classId:classes[0].id,subjects:[]}})});await loading;assert.equal(page.host.hidden,true);assert.equal(page.host.innerHTML,'');
});

test('sample loading, unavailable and recoverable failure states support retry without stale data',async()=>{
 let attempt=0;const page=await browser(async body=>++attempt===1?{ok:false,status:404,json:async()=>({})}:attempt===2?{ok:false,status:500,json:async()=>({})}:{ok:true,json:async()=>({result:{isSample:true,isPreview:true,classId:body.classId,subjects:[]}})});page.toggle(true);const initial=page.submit();assert.equal(page.status.textContent,'Loading sample result...');await initial;assert.equal(page.status.textContent,'Sample result is unavailable for the selected class.');await page.retryResult.handlers.click();assert.equal(page.status.textContent,'Unable to load sample result. Please try again.');await page.retryResult.handlers.click();assert.equal(page.host.hidden,false);assert.equal(page.status.textContent,'');
});

test('sample timeout ends loading and makes retry available',async()=>{const page=await browser(()=>new Promise(()=>{}));page.ctx.setTimeout=fn=>setTimeout(fn,1);page.toggle(true);await page.submit();assert.equal(page.status.textContent,'Unable to load sample result. Please try again.');assert.equal(page.retryResult.hidden,false);});

sqlTest('teacher subject assignment restrictions are preserved', async () => {
 const f=fixture();try{
  const teacher={...actor,roleKey:'TEACHER',assignedClassIds:[classes[0].id],assignedSubjectIds:['db-class-0-subject-0'],permissions:new Set(['results.generate'])};
  await assert.rejects(f.workflow.generateForContext(input(),teacher),{status:403});
  teacher.assignedSubjectIds.push('db-class-0-subject-1');assert.equal((await f.workflow.generateForContext(input(),teacher)).subjects.length,2);
 }finally{f.db.close();}
});

sqlTest('existing school signature resolution receives canonical class context and PDF assessment data is retained', async () => {
 const f=fixture();try{
  const observed=[];const workflow=createSampleResultWorkflow({students:f.students,subjects:f.subjects,academicResults:f.results,schoolId,resolveContext:f.durable.sampleContext,signatures:{resolveForStudent(student,period){observed.push({schoolId:student.schoolId,classId:student.classId,period});return {headteacher:{name:'School head',signature:{id:'own-school-signature',storageKey:'signatures/head.png'}}};}}});
  const r=await workflow.generateForContext(input(5),actor);assert.deepEqual(observed,[{schoolId,classId:classes[5].id,period:{academicYear:'2026/2027',term:'First Term'}}]);assert.equal(r.signatures[0].id,'own-school-signature');assert.deepEqual(r.assessment,r.assessments);
 }finally{f.db.close();}
});
