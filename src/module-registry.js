import { registerModule } from './sidebar-registry.js';

registerModule({ moduleKey: 'student-profiles', moduleName: 'Student Profiles', category: 'STUDENTS MANAGEMENT', route: '/students', icon: '◎', displayOrder: 1, requiredPermission: 'students.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER'] });
registerModule({ moduleKey: 'student-search', moduleName: 'Student Search', category: 'STUDENTS MANAGEMENT', route: '/students/search', icon: '⌕', displayOrder: 2, requiredPermission: 'students.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER', 'ADMISSIONS_OFFICER'] });
registerModule({ moduleKey: 'admissions', moduleName: 'Admissions', category: 'ADMISSIONS', route: '/admissions', icon: '✦', displayOrder: 1, requiredPermission: 'admissions.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'ADMISSIONS_OFFICER'] });
