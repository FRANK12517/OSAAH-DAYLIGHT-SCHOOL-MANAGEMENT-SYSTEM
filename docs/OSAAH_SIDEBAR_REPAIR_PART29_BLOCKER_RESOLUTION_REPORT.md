# OSAAH Daylight School Complex
## Part 29 — Sidebar Blocker Resolution and Release Certification

This report is generated from inline-codedocs/role-sidebar-route-audit.jsoninline-code by the repaired application route registry. The historical Part 28 artifact itself was not present in the checkout; the supplied Part 29 specification provided its verified aggregate baseline of 81 blockers, which is retained below rather than overwritten.

## Original Part 28 blocker reconciliation

| Original blocker class | Count | Final outcome |
|---|---:|---|
| Missing component targets | 31 | **FIXED** through existing shared-shell/component contracts |
| Duplicate/shared route blockers | 50 | **INTENTIONAL SHARED ROUTE WITH EXACT CONTRACT** after stable navigation-key and exact-view propagation |
| Obsolete entries | 0 | No entry was removed without repository evidence |
| Still blocked | 0 | No current certified blocker |
| **Total** | **81** | **Reconciled** |

The release gate was not weakened. It now validates navigation key → route → exact view/component, recognizes valid shared shells only when their contracts are distinct, rejects placeholder targets, and detects unresolved route identity. The two demonstrably redundant legacy collection registrations were removed from the side-effect registry because the canonical Extra Classes and Canteen entries already existed; the working features were not removed.

## Current release-gate result

| Measure | Result |
|---|---:|
| Role/destination records | 211 |
| Component-target passes | 211 |
| Release blockers | 0 |
| Duplicate-route blockers | 0 |
| Missing-component-target blockers | 0 |
| Status | **PASS** |

## Root cause by route family

The academic, attendance, staff, student, finance, fee, reports, and operations families had stable labels and routes but lacked a uniform exact-view/component contract at the dashboard boundary. Broad shared shells therefore could not prove which child had been selected, and a previous merge left unresolved conflict markers in inline-codepublic/app.jsinline-code. Part 29 reconnects existing implementations instead of creating duplicate or empty pages.

The browser shell now persists inline-codenavigationKeyinline-code and inline-codeviewinline-code in the URL, injects the selected component/view into protected HTML, restores it on refresh and history navigation, and ignores stale iframe callbacks from superseded requests.

## Role certifications

| Role | Historical Part 28 baseline | Final destinations | Final passes | Final blockers |
|---|---|---:|---:|---:|
| Accountant | 17 destinations, 17 passes | 36 | 36 | 0 |
| Headteacher | 66 destinations, 48 passes, 18 blockers | 102 | 102 | 0 |
| Assistant Headteacher | 6 destinations, 6 passes | 15 | 15 | 0 |
| Teacher | 38 destinations, 25 passes, 13 blockers | 58 | 58 | 0 |

The final counts are larger than the historical screenshot/current-registry counts because the current role-aware registry includes the expanded authorized module catalog. All currently visible records are certified; no role was excluded to improve the result.

## Required route-family repairs

Student Search reconnects to inline-codestudent-canonical.htmlinline-code and therefore retains canonical student records and school scoping. Student Attendance reconnects to inline-codeattendance.htmlinline-code; Staff Attendance uses inline-codestaff-attendance.htmlinline-code; Attendance Reports uses inline-codereports-academic.htmlinline-code. Staff & HR, Leave, Performance, Qualifications, and Teachers reconnect to the existing staff/leave shells. Academic children use the existing academic shell with exact child views. Fee, Finance, Reports, and Operations children receive explicit view contracts, including same-label Receipts entries under different parents.

## Accountant destination certification

| Navigation key | Display label | Route | Exact view | Component | Result |
|---|---|---|---|---|---|
| user-guide | User Guide | /user-guide | user-guide | /operations-canonical.html | PASS |
| official-documents | Official Documents | /official-documents | official-documents | /operations-canonical.html | PASS |
| class-database | Class Database | /class-database.html | class-database | /class-database.html | PASS |
| completed-class-database | Completed Class Database / Archives | /completed-class-database.html | completed-class-database | /completed-class-database.html | PASS |
| fees | Fees | /fees | fees-overview | /operations-canonical.html | PASS |
| extra-classes | Extra Classes | /fees/collections/extra-classes | extra-classes | /collections.html | PASS |
| canteen | Canteen | /fees/collections/canteen | canteen | /canteen.html | PASS |
| invoices | Invoices & Receipts | /fees/invoices | invoices-receipts | /finance-canonical.html | PASS |
| fee-structure | Fee Structure | /fees/structure | fee-structure | /finance-canonical.html | PASS |
| fee.scholarships | Scholarships | /fees/scholarships | fee.scholarships | /finance-canonical.html | PASS |
| admission-fee-management | Admission Fee Structures | /fees/admission-structures | admission-fee-structures | /finance-canonical.html | PASS |
| fee-setup | Fee Setup | /fees/setup | fee-setup | /fee-setup.html | PASS |
| collection-reports | Collection Reports | /fees/collections/reports | collection-reports | /collection-reports.html | PASS |
| student-fees | Student Fees | /fees/students | student-fees | /finance-canonical.html | PASS |
| payments | Payments | /fees/payments | payments | /finance-canonical.html | PASS |
| receipts | Receipts | /fees/receipts | fee-receipts | /finance-canonical.html | PASS |
| arrears | Arrears | /fees/arrears | arrears | /finance-canonical.html | PASS |
| discounts | Discounts | /fees/discounts | discounts | /finance-canonical.html | PASS |
| fee-statements | Fee Statements | /fees/statements | fee-statements | /finance-canonical.html | PASS |
| finance | Finance | /finance | finance-overview | /operations-canonical.html | PASS |
| finance-reports | Finance Reports | /finance/reports | finance-reports | /finance-canonical.html | PASS |
| income | Income | /finance/income | income | /finance-canonical.html | PASS |
| expenses | Expenses | /finance/expenses | expenses | /finance-canonical.html | PASS |
| cashbook | Cashbook | /finance/cashbook | cashbook | /finance-canonical.html | PASS |
| budgets | Budgets | /finance/budgets | budgets | /finance-canonical.html | PASS |
| finance-receipts | Receipts | /finance/receipts | finance-receipts | /finance-canonical.html | PASS |
| reports | Reports & Analytics | /reports | reports-overview | /operations-canonical.html | PASS |
| academic-reports | Academic Reports | /reports/academic | academic-reports | /operations-canonical.html | PASS |
| attendance-reports-management | Attendance Reports | /reports/attendance | attendance-reports | /reports-academic.html | PASS |
| financial-reports | Financial Reports | /reports/financial | financial-reports | /operations-canonical.html | PASS |
| enrollment-reports | Enrollment Reports | /reports/enrollment | enrollment-reports | /operations-canonical.html | PASS |
| staff-reports | Staff Reports | /reports/staff | staff-reports | /operations-canonical.html | PASS |
| operational-reports | Operational Reports | /reports/operations | operational-reports | /operations-canonical.html | PASS |
| management-dashboard | Management Dashboard | /reports/management | management-dashboard | /operations-canonical.html | PASS |
| about-developer | About the Developer | /about-developer | about-developer | /about-developer.html | PASS |
| copyright | Copyright | /copyright | copyright | /copyright.html | PASS |

## Headteacher destination certification

| Navigation key | Display label | Route | Exact view | Component | Result |
|---|---|---|---|---|---|
| dashboard | Dashboard Overview | / | dashboard | /index.html | PASS |
| user-guide | User Guide | /user-guide | user-guide | /operations-canonical.html | PASS |
| official-documents | Official Documents | /official-documents | official-documents | /operations-canonical.html | PASS |
| signature-management | Result Signatures | /settings/result-signatures | signature-management | /operations-canonical.html | PASS |
| school-profile | School Profile | /settings/profile | school-profile | /operations-canonical.html | PASS |
| academic-calendar | Academic Calendar | /communication/calendar | academic-calendar | /communication.html | PASS |
| student-profiles | Student Profiles | /students | student-profiles | /operations-canonical.html | PASS |
| class-database | Class Database | /class-database.html | class-database | /class-database.html | PASS |
| student-search | Student Search | /students/search | student-search | /student-canonical.html | PASS |
| completed-class-database | Completed Class Database / Archives | /completed-class-database.html | completed-class-database | /completed-class-database.html | PASS |
| student-directory | Student Directory | /students/directory | student-directory | /operations-canonical.html | PASS |
| student-ids | Student IDs | /students/ids | student-ids | /operations-canonical.html | PASS |
| student-transfers | Transfers | /students/transfers | student-transfers | /operations-canonical.html | PASS |
| student-alumni | Alumni | /students/alumni | student-alumni | /operations-canonical.html | PASS |
| admission-prospectus | Admission Prospectus Management | /admissions/prospectus | admission-prospectus | /operations-canonical.html | PASS |
| academics | Academics | /academics | academics-overview | /operations-canonical.html | PASS |
| sporting-activities | Sporting Activities | /sporting-activities | sporting-activities | /operations-canonical.html | PASS |
| subject-management | Subject Management | /academics/subjects | subject-management | /subjects.html | PASS |
| subject-register | Subject Register | /academics/subject-register | subject-register | /subject-register.html | PASS |
| academic-years | Academic Years | /academics/years | academic-years | /academic-modules.html | PASS |
| academic-terms | Terms | /academics/terms | academic-terms | /academic-modules.html | PASS |
| academic-classes | Classes | /academics/classes | academic-classes | /academic-modules.html | PASS |
| academic-subjects | Subjects | /academics/subjects/list | academic-subjects | /subjects.html | PASS |
| teacher-assignments | Teacher Assignments | /academics/teacher-assignments | teacher-assignments | /academic-modules.html | PASS |
| curriculum | Curriculum | /academics/curriculum | curriculum | /academic-modules.html | PASS |
| lesson-plans | Lesson Plans | /academics/lesson-plans | lesson-plans | /academic-modules.html | PASS |
| academic-assignments | Assignments | /academics/assignments | academic-assignments | /academic-modules.html | PASS |
| timetable | Timetable | /academics/timetable | academic-timetable | /academic-modules.html | PASS |
| attendance-dashboard | Attendance Dashboard | /attendance | attendance-overview | /operations-canonical.html | PASS |
| student-attendance | Student Attendance | /attendance/students | student-attendance-register | /attendance.html | PASS |
| staff-attendance | Staff Attendance | /attendance/staff | staff-attendance-register | /staff-attendance.html | PASS |
| attendance-reports | Attendance Reports | /attendance/reports | attendance-reporting | /reports-academic.html | PASS |
| attendance-alerts | Attendance Alerts | /attendance/alerts | attendance-alerts | /operations-canonical.html | PASS |
| examinations | Examinations | /examinations | examinations | /operations-canonical.html | PASS |
| results | Results & Reports | /results | results | /operations-canonical.html | PASS |
| promotion | Promotion | /promotion | promotion | /operations-canonical.html | PASS |
| mock-score-entry | Mock Score Entry | /examinations/mock | mock-score-entry | /operations-canonical.html | PASS |
| mock-results | Mock Results | /results/mock | mock-results | /operations-canonical.html | PASS |
| exam-timetable | Exam Timetable | /examinations/timetable | exam-timetable | /exam-timetable.html | PASS |
| broadsheets | Broadsheets | /results/broadsheets | broadsheets | /operations-canonical.html | PASS |
| report-cards | Report Cards | /results/report-cards | report-cards | /operations-canonical.html | PASS |
| promotion-results | Promotion Results | /results/promotions | promotion-results | /operations-canonical.html | PASS |
| fee-structure | Fee Structure | /fees/structure | fee-structure | /finance-canonical.html | PASS |
| fee.scholarships | Scholarships | /fees/scholarships | fee.scholarships | /finance-canonical.html | PASS |
| admission-fee-management | Admission Fee Structures | /fees/admission-structures | admission-fee-structures | /finance-canonical.html | PASS |
| collection-reports | Collection Reports | /fees/collections/reports | collection-reports | /collection-reports.html | PASS |
| student-fees | Student Fees | /fees/students | student-fees | /finance-canonical.html | PASS |
| payments | Payments | /fees/payments | payments | /finance-canonical.html | PASS |
| receipts | Receipts | /fees/receipts | fee-receipts | /finance-canonical.html | PASS |
| arrears | Arrears | /fees/arrears | arrears | /finance-canonical.html | PASS |
| discounts | Discounts | /fees/discounts | discounts | /finance-canonical.html | PASS |
| fee-statements | Fee Statements | /fees/statements | fee-statements | /finance-canonical.html | PASS |
| finance-reports | Finance Reports | /finance/reports | finance-reports | /finance-canonical.html | PASS |
| income | Income | /finance/income | income | /finance-canonical.html | PASS |
| expenses | Expenses | /finance/expenses | expenses | /finance-canonical.html | PASS |
| cashbook | Cashbook | /finance/cashbook | cashbook | /finance-canonical.html | PASS |
| budgets | Budgets | /finance/budgets | budgets | /finance-canonical.html | PASS |
| finance-receipts | Receipts | /finance/receipts | finance-receipts | /finance-canonical.html | PASS |
| staff-directory | Staff Directory | /staff | staff-directory | /operations-canonical.html | PASS |
| teachers | Teachers | /staff/teachers | teachers-register | /staff-canonical.html | PASS |
| staff-attendance-hr | Staff Attendance | /staff/attendance | staff-attendance-register | /staff-attendance.html | PASS |
| performance | Performance | /staff/performance | staff-performance | /staff-canonical.html | PASS |
| staff.professional-development | Professional Development | /staff/professional-development | professional-development | /staff-canonical.html | PASS |
| qualifications-licences | Qualifications | /staff/qualifications | qualifications | /staff-canonical.html | PASS |
| ntc-records | NTC Records | /staff/ntc-records | ntc-records | /staff-canonical.html | PASS |
| appraisals | Appraisal | /staff/appraisal | staff-appraisal | /staff-canonical.html | PASS |
| hr-documents | HR Documents | /staff/documents | hr-documents | /staff-canonical.html | PASS |
| announcements | Announcements | /communication | announcements | /operations-canonical.html | PASS |
| messages | Messages | /communication/messages | messages | /communication.html | PASS |
| calendar | School Calendar | /communication/school-calendar | calendar | /communication.html | PASS |
| sms | SMS | /communication/sms | sms | /operations-canonical.html | PASS |
| email | Email | /communication/email | email | /operations-canonical.html | PASS |
| notifications | Notifications | /communication/notifications | notifications | /operations-canonical.html | PASS |
| communication-history | Communication History | /communication/history | communication-history | /operations-canonical.html | PASS |
| discipline | Discipline | /welfare/discipline | discipline | /operations-canonical.html | PASS |
| counselling | Guidance & Counselling | /welfare/counselling | counselling | /operations-canonical.html | PASS |
| shep-activities | SHEP Activities | /welfare/shep | shep-activities | /operations-canonical.html | PASS |
| assets | Assets | /assets | assets | /operations-canonical.html | PASS |
| property | School Property | /property | property | /operations-canonical.html | PASS |
| buildings | Buildings | /property/buildings | buildings | /operations-canonical.html | PASS |
| furniture | Furniture | /property/furniture | furniture | /operations-canonical.html | PASS |
| maintenance | Maintenance | /property/maintenance | maintenance | /operations-canonical.html | PASS |
| property-reports | Property Reports | /property/reports | property-reports | /operations-canonical.html | PASS |
| compliance | Compliance & Regulatory | /compliance | compliance | /operations-canonical.html | PASS |
| nasia | NaSIA | /compliance/nasia | nasia | /operations-canonical.html | PASS |
| ntc | NTC | /compliance/ntc | ntc | /operations-canonical.html | PASS |
| fire-safety | Fire Safety | /compliance/fire-safety | fire-safety | /operations-canonical.html | PASS |
| emis-census | EMIS / School Census | /compliance/emis-census | emis-census | /operations-canonical.html | PASS |
| inspections | Inspections | /compliance/inspections | inspections | /operations-canonical.html | PASS |
| compliance-calendar | Compliance Calendar | /compliance/calendar | compliance-calendar | /operations-canonical.html | PASS |
| document-repository | Document Repository | /documents/repository | document-repository | /operations-canonical.html | PASS |
| reports | Reports & Analytics | /reports | reports-overview | /operations-canonical.html | PASS |
| admission-analytics | Admission Analytics | /reports/admissions | admission-analytics | /operations-canonical.html | PASS |
| academic-reports | Academic Reports | /reports/academic | academic-reports | /operations-canonical.html | PASS |
| attendance-reports-management | Attendance Reports | /reports/attendance | attendance-reports | /reports-academic.html | PASS |
| financial-reports | Financial Reports | /reports/financial | financial-reports | /operations-canonical.html | PASS |
| enrollment-reports | Enrollment Reports | /reports/enrollment | enrollment-reports | /operations-canonical.html | PASS |
| staff-reports | Staff Reports | /reports/staff | staff-reports | /operations-canonical.html | PASS |
| operational-reports | Operational Reports | /reports/operations | operational-reports | /operations-canonical.html | PASS |
| management-dashboard | Management Dashboard | /reports/management | management-dashboard | /operations-canonical.html | PASS |
| about-developer | About the Developer | /about-developer | about-developer | /about-developer.html | PASS |
| copyright | Copyright | /copyright | copyright | /copyright.html | PASS |

## Assistant Headteacher destination certification

| Navigation key | Display label | Route | Exact view | Component | Result |
|---|---|---|---|---|---|
| user-guide | User Guide | /user-guide | user-guide | /operations-canonical.html | PASS |
| class-database | Class Database | /class-database.html | class-database | /class-database.html | PASS |
| completed-class-database | Completed Class Database / Archives | /completed-class-database.html | completed-class-database | /completed-class-database.html | PASS |
| admission-prospectus | Admission Prospectus Management | /admissions/prospectus | admission-prospectus | /operations-canonical.html | PASS |
| sporting-activities | Sporting Activities | /sporting-activities | sporting-activities | /operations-canonical.html | PASS |
| subject-management | Subject Management | /academics/subjects | subject-management | /subjects.html | PASS |
| subject-register | Subject Register | /academics/subject-register | subject-register | /subject-register.html | PASS |
| mock-score-entry | Mock Score Entry | /examinations/mock | mock-score-entry | /operations-canonical.html | PASS |
| mock-results | Mock Results | /results/mock | mock-results | /operations-canonical.html | PASS |
| exam-timetable | Exam Timetable | /examinations/timetable | exam-timetable | /exam-timetable.html | PASS |
| admission-fee-management | Admission Fee Structures | /fees/admission-structures | admission-fee-structures | /finance-canonical.html | PASS |
| shep-activities | SHEP Activities | /welfare/shep | shep-activities | /operations-canonical.html | PASS |
| admission-analytics | Admission Analytics | /reports/admissions | admission-analytics | /operations-canonical.html | PASS |
| about-developer | About the Developer | /about-developer | about-developer | /about-developer.html | PASS |
| copyright | Copyright | /copyright | copyright | /copyright.html | PASS |

## Teacher destination certification

| Navigation key | Display label | Route | Exact view | Component | Result |
|---|---|---|---|---|---|
| dashboard | Dashboard Overview | / | dashboard | /index.html | PASS |
| user-guide | User Guide | /user-guide | user-guide | /operations-canonical.html | PASS |
| student-profiles | Student Profiles | /students | student-profiles | /operations-canonical.html | PASS |
| class-database | Class Database | /class-database.html | class-database | /class-database.html | PASS |
| student-search | Student Search | /students/search | student-search | /student-canonical.html | PASS |
| completed-class-database | Completed Class Database / Archives | /completed-class-database.html | completed-class-database | /completed-class-database.html | PASS |
| student-directory | Student Directory | /students/directory | student-directory | /operations-canonical.html | PASS |
| student-ids | Student IDs | /students/ids | student-ids | /operations-canonical.html | PASS |
| student-transfers | Transfers | /students/transfers | student-transfers | /operations-canonical.html | PASS |
| student-alumni | Alumni | /students/alumni | student-alumni | /operations-canonical.html | PASS |
| academics | Academics | /academics | academics-overview | /operations-canonical.html | PASS |
| sporting-activities | Sporting Activities | /sporting-activities | sporting-activities | /operations-canonical.html | PASS |
| subject-register | Subject Register | /academics/subject-register | subject-register | /subject-register.html | PASS |
| academic-years | Academic Years | /academics/years | academic-years | /academic-modules.html | PASS |
| academic-terms | Terms | /academics/terms | academic-terms | /academic-modules.html | PASS |
| academic-classes | Classes | /academics/classes | academic-classes | /academic-modules.html | PASS |
| academic-subjects | Subjects | /academics/subjects/list | academic-subjects | /subjects.html | PASS |
| teacher-assignments | Teacher Assignments | /academics/teacher-assignments | teacher-assignments | /academic-modules.html | PASS |
| curriculum | Curriculum | /academics/curriculum | curriculum | /academic-modules.html | PASS |
| lesson-plans | Lesson Plans | /academics/lesson-plans | lesson-plans | /academic-modules.html | PASS |
| academic-assignments | Assignments | /academics/assignments | academic-assignments | /academic-modules.html | PASS |
| timetable | Timetable | /academics/timetable | academic-timetable | /academic-modules.html | PASS |
| attendance-dashboard | Attendance Dashboard | /attendance | attendance-overview | /operations-canonical.html | PASS |
| student-attendance | Student Attendance | /attendance/students | student-attendance-register | /attendance.html | PASS |
| attendance-alerts | Attendance Alerts | /attendance/alerts | attendance-alerts | /operations-canonical.html | PASS |
| examinations | Examinations | /examinations | examinations | /operations-canonical.html | PASS |
| marks-entry | Marks Entry | /examinations/marks | marks-entry | /operations-canonical.html | PASS |
| results | Results & Reports | /results | results | /operations-canonical.html | PASS |
| mock-score-entry | Mock Score Entry | /examinations/mock | mock-score-entry | /operations-canonical.html | PASS |
| mock-results | Mock Results | /results/mock | mock-results | /operations-canonical.html | PASS |
| broadsheets | Broadsheets | /results/broadsheets | broadsheets | /operations-canonical.html | PASS |
| report-cards | Report Cards | /results/report-cards | report-cards | /operations-canonical.html | PASS |
| promotion-results | Promotion Results | /results/promotions | promotion-results | /operations-canonical.html | PASS |
| leave | Leave | /staff/leave | leave-management | /leave.html | PASS |
| staff.professional-development | Professional Development | /staff/professional-development | professional-development | /staff-canonical.html | PASS |
| announcements | Announcements | /communication | announcements | /operations-canonical.html | PASS |
| messages | Messages | /communication/messages | messages | /communication.html | PASS |
| calendar | School Calendar | /communication/school-calendar | calendar | /communication.html | PASS |
| sms | SMS | /communication/sms | sms | /operations-canonical.html | PASS |
| email | Email | /communication/email | email | /operations-canonical.html | PASS |
| notifications | Notifications | /communication/notifications | notifications | /operations-canonical.html | PASS |
| communication-history | Communication History | /communication/history | communication-history | /operations-canonical.html | PASS |
| discipline | Discipline | /welfare/discipline | discipline | /operations-canonical.html | PASS |
| shep-activities | SHEP Activities | /welfare/shep | shep-activities | /operations-canonical.html | PASS |
| inventory | Inventory & Stores | /inventory | inventory | /operations-canonical.html | PASS |
| stock | Stock | /inventory/stock | stock | /operations-canonical.html | PASS |
| stock-in | Stock In | /inventory/stock-in | stock-in | /operations-canonical.html | PASS |
| stock-out | Stock Out | /inventory/stock-out | stock-out | /operations-canonical.html | PASS |
| suppliers | Suppliers | /inventory/suppliers | suppliers | /operations-canonical.html | PASS |
| inventory-reports | Inventory Reports | /inventory/reports | inventory-reports | /operations-canonical.html | PASS |
| property | School Property | /property | property | /operations-canonical.html | PASS |
| property-requests | Property Requests | /property/requests | property-requests | /operations-canonical.html | PASS |
| buildings | Buildings | /property/buildings | buildings | /operations-canonical.html | PASS |
| furniture | Furniture | /property/furniture | furniture | /operations-canonical.html | PASS |
| maintenance | Maintenance | /property/maintenance | maintenance | /operations-canonical.html | PASS |
| property-reports | Property Reports | /property/reports | property-reports | /operations-canonical.html | PASS |
| about-developer | About the Developer | /about-developer | about-developer | /about-developer.html | PASS |
| copyright | Copyright | /copyright | copyright | /copyright.html | PASS |

## Security, database, and functional scope

No database migration or production-data mutation was made. Existing server-side RBAC and school-scoped APIs remain authoritative. Anonymous access, role authorization, school isolation, financial protection, session expiry, logout, and secret-handling behavior remain covered by the existing regression suite. This repair adds routing/component certification only.

## Validation

The focused route suite passed 26/26 tests. The complete repository suite passed 654/654 tests with 0 failures and 0 skips. Migration validation reported 32 valid migrations, login asset verification passed for 12 protected assets, and whitespace validation passed.

## Files and delivery

The implementation is on the dedicated branch inline-codefix/part29-sidebar-release-blockersinline-code. The required release-gate artifact is generated from current code; no output was manually edited. No new functional HTML pages were necessary.
