import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibleSidebar } from './sidebar-registry.js';
import { canAccess, createAuthService } from './auth.js';
import { createAuditLog } from './audit.js';
import { createStudentService } from './students.js';
import { createAttendanceService } from './attendance.js';
import './module-registry.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const branding = { schoolName: 'OSAAH DAYLIGHT SCH. COM.', location: 'BOGOSO', motto: 'AIM HIGH, ACADEMIC IS OUR CORE VALUE', logoPath: '/assets/osaah-daylight-logo.png', colours: { navy: '#102a43', royalBlue: '#1769aa', gold: '#d4a72c', white: '#ffffff' } };

export function createApp({ auth = createAuthService(), students = createStudentService(), attendance = createAttendanceService(), audit = () => {} } = {}) {
  return async function handle(request, response) {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/api/branding') return json(response, branding);
    if (pathname === '/api/auth/login' && request.method === 'POST') return login(request, response, auth);
    if (pathname === '/api/auth/logout' && request.method === 'POST') { auth.logout(readCookie(request, 'osaah_session')); return json(response, { ok: true }, 204); }
    if (pathname === '/api/auth/password-reset' && request.method === 'POST') { const body = await readJson(request); return json(response, auth.requestPasswordReset(body.username ?? '')); }
    if (pathname === '/api/auth/password-reset/complete' && request.method === 'POST') { const body = await readJson(request); const result = auth.completePasswordReset(body.token ?? '', body.newPassword ?? ''); return json(response, result, result.ok ? 200 : 400); }
    if (pathname.startsWith('/api/')) {
      const user = auth.authenticate(readCookie(request, 'osaah_session') ?? bearer(request));
      if (!user) return json(response, { error: 'Authentication required.' }, 401);
      if (pathname === '/api/sidebar') return json(response, { user: publicUser(user), categories: visibleSidebar({ permissions: user.permissions, roleKey: user.roleKey }) });
      if (pathname === '/api/students' && request.method === 'POST') { if (!canAccess(user, 'students.write')) return json(response, { error: 'Forbidden.' }, 403); const student = students.createStudent({ ...(await readJson(request)), schoolId: user.schoolId }); audit(createAuditLog({ schoolId: user.schoolId, userId: user.id, action: 'CREATE', entity: 'Student', entityId: student.id, newValue: student })); return json(response, student, 201); }
      if (pathname === '/api/students/search') { if (!canAccess(user, 'students.read')) return json(response, { error: 'Forbidden.' }, 403); return json(response, { students: students.search(new URL(request.url, 'http://localhost').searchParams.get('q'), { ...user, requestedSchoolId: user.schoolId }) }); }
      if (pathname === '/api/attendance/students' && request.method === 'POST') { if (user.portal === 'parent' || !canAccess(user, 'attendance.write')) return json(response, { error: 'Forbidden.' }, 403); const body = await readJson(request); const correction = Boolean(body.correction); if (correction && !canAccess(user, 'attendance.correct')) return json(response, { error: 'Attendance corrections require authorization.' }, 403); const record = attendance.saveStudentAttendance({ ...body, schoolId: user.schoolId }, user, { correction, expectedVersion: body.expectedVersion ?? null }); audit(createAuditLog({ schoolId: user.schoolId, userId: user.id, action: correction ? 'CORRECT' : 'CREATE', entity: 'StudentAttendance', entityId: record.id, newValue: record })); return json(response, record, 201); }
      if (pathname === '/api/attendance/students/sync' && request.method === 'POST') { if (user.portal === 'parent' || !canAccess(user, 'attendance.write')) return json(response, { error: 'Forbidden.' }, 403); const body = await readJson(request); try { const records = attendance.saveBatch(body.entries ?? [], user, { correction: false, expectedVersion: body.expectedVersion ?? null }); return json(response, { synced: records }); } catch (error) { return json(response, { error: error.message, conflict: error.message.includes('conflict') }, 409); } }
      if (pathname === '/api/attendance/students' && request.method === 'GET') { const query = new URL(request.url, 'http://localhost').searchParams; if (user.portal === 'parent') { const ids = (user.children ?? []).map((child) => child.id); return json(response, attendance.summary({ date: query.get('date') ?? undefined, classId: query.get('classId') ?? undefined, studentIds: ids })); } if (!canAccess(user, 'attendance.read')) return json(response, { error: 'Forbidden.' }, 403); return json(response, attendance.summary({ date: query.get('date') ?? undefined, classId: query.get('classId') ?? undefined, subjectId: query.get('subjectId') ?? undefined, studentIds: user.roleKey === 'TEACHER' ? user.assignedStudentIds : undefined })); }
      if (pathname === '/api/attendance/staff' && request.method === 'POST') { if (!canAccess(user, 'staff.attendance.write')) return json(response, { error: 'Forbidden.' }, 403); const record = attendance.saveStaffAttendance(await readJson(request), user); audit(createAuditLog({ schoolId: user.schoolId, userId: user.id, action: 'CREATE', entity: 'StaffAttendance', entityId: record.id, newValue: record })); return json(response, record, 201); }
      if (pathname === '/api/attendance/notifications' && request.method === 'POST') { if (user.portal !== 'parent') return json(response, { error: 'Forbidden.' }, 403); return json(response, attendance.setNotificationSettings(user.id, await readJson(request))); }
      if (pathname.startsWith('/api/students/')) { const parts = pathname.split('/').filter(Boolean); const studentId = parts[2]; if (parts[3] === 'class' && request.method === 'POST') { if (!canAccess(user, 'students.write')) return json(response, { error: 'Forbidden.' }, 403); return json(response, students.assignClass(studentId, await readJson(request))); } if (parts[3] === 'parents' && request.method === 'POST') { if (!canAccess(user, 'students.write')) return json(response, { error: 'Forbidden.' }, 403); return json(response, students.linkParent(studentId, await readJson(request)), 201); } if (request.method === 'GET') { if (!canAccess(user, 'students.read')) return json(response, { error: 'Forbidden.' }, 403); const record = students.getStudent(studentId, { allowHealth: canAccess(user, 'health.read'), requestedSchoolId: user.schoolId }); return record ? json(response, record) : json(response, { error: 'Not found.' }, 404); } }
      if (pathname === '/api/admissions' && request.method === 'POST') { if (!canAccess(user, 'admissions.write')) return json(response, { error: 'Forbidden.' }, 403); const application = students.createAdmission(await readJson(request)); audit(createAuditLog({ schoolId: user.schoolId, userId: user.id, action: 'CREATE', entity: 'AdmissionApplication', entityId: application.applicationNumber, newValue: application })); return json(response, application, 201); }
      if (pathname.startsWith('/api/admissions/') && pathname.endsWith('/advance') && request.method === 'POST') { if (!canAccess(user, 'admissions.write')) return json(response, { error: 'Forbidden.' }, 403); const applicationNumber = pathname.split('/')[3]; const application = students.advanceAdmission(applicationNumber, (await readJson(request)).stage); audit(createAuditLog({ schoolId: user.schoolId, userId: user.id, action: 'ADVANCE', entity: 'AdmissionApplication', entityId: applicationNumber, newValue: application })); return json(response, application); }
      if (pathname === '/api/parent/children') { if (user.portal !== 'parent' || !canAccess(user, 'children.read')) return json(response, { error: 'Forbidden.' }, 403); return json(response, { children: user.children }); }
      if (pathname === '/api/management') { if (!canAccess(user, 'users.read')) return json(response, { error: 'Forbidden.' }, 403); audit(createAuditLog({ schoolId: user.schoolId, userId: user.id, action: 'ACCESS', entity: 'ManagementDashboard' })); return json(response, { authorized: true, schoolId: user.schoolId }); }
      return json(response, { error: 'Not found.' }, 404);
    }
    const file = pathname === '/' ? '/index.html' : pathname;
    try { const body = await readFile(join(root, file)); response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); response.end(body); } catch { response.writeHead(404); response.end('Not found'); }
  };
}
const server = createServer(createApp());
const port = Number(process.env.OSAAH_PORT || 3000);
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(port, () => console.log(`OsaaH foundation listening on http://localhost:${port}`));
export { server };
function publicUser(user) { return { id: user.id, username: user.username, portal: user.portal, roleKey: user.roleKey, schoolId: user.schoolId, children: user.children ?? [], assignedStudentIds: user.assignedStudentIds ?? [], assignedClassIds: user.assignedClassIds ?? [], assignedSubjectIds: user.assignedSubjectIds ?? [], assignedDepartmentIds: user.assignedDepartmentIds ?? [] }; }
async function login(request, response, auth) { const body = await readJson(request); const result = auth.login(body); if (!result.ok) return json(response, { error: result.error }, result.status); return json(response, { user: result.user, expiresAt: result.expiresAt }, 200, `osaah_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(auth.sessionTtlMs / 1000)}`); }
function readCookie(request, name) { return (request.headers.cookie ?? '').split(';').map((part) => part.trim().split('=')).find(([key]) => key === name)?.[1]; }
function bearer(request) { const value = request.headers.authorization ?? ''; return value.startsWith('Bearer ') ? value.slice(7) : null; }
function readJson(request) { return new Promise((resolve, reject) => { let data = ''; request.on('data', (chunk) => { data += chunk; if (data.length > 100_000) request.destroy(); }); request.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON')); } }); }); }
function json(response, value, status = 200, cookie) { const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }; if (cookie) headers['Set-Cookie'] = cookie; response.writeHead(status, headers); response.end(status === 204 ? '' : JSON.stringify(value)); }
