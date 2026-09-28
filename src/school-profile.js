const clone = (value) => JSON.parse(JSON.stringify(value));
const leadershipRoles = new Set(['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'SCHOOL_ADMIN', 'ADMINISTRATOR', 'ACCOUNTANT', 'ACCOUNTANT_BURSAR']);
const roleLabel = (role) => ({ PROPRIETOR: 'Proprietor', HEADTEACHER: 'Headteacher', ASSISTANT_HEADTEACHER: 'Assistant Headteacher', SCHOOL_ADMIN: 'Administrator', ADMINISTRATOR: 'Administrator', ACCOUNTANT: 'Accountant', ACCOUNTANT_BURSAR: 'Accountant' }[String(role ?? '').toUpperCase()] ?? String(role ?? '').replaceAll('_', ' '));
const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const canView = (actor) => actor?.portal === 'school' && actor.schoolId && (actor.permissions?.has?.('*') || actor.permissions?.has?.('settings.read') || ['PROPRIETOR', 'SCHOOL_ADMIN'].includes(actor.roleKey));
const canEdit = (actor) => canView(actor) && (actor.permissions?.has?.('*') || actor.permissions?.has?.('settings.write') || ['PROPRIETOR', 'SCHOOL_ADMIN'].includes(actor.roleKey));

export function createSchoolProfileService({ database = null, schoolSettings, singleSchoolOverview, staff = null, schoolId }) {
  const optional = async (sql, params = []) => { try { return database?.query ? await database.query(sql, params) : []; } catch { return []; } };
  async function leadership(actor) {
    const rows = database?.query ? await optional('SELECT id,full_name AS fullName,phone,role_key AS roleKey FROM staff_profiles WHERE school_id=? ORDER BY full_name,id', [schoolId]) : (staff?.listProfiles?.() ?? []);
    return rows.filter((row) => row.schoolId === undefined || row.schoolId === schoolId).filter((row) => leadershipRoles.has(String(row.roleKey ?? '').toUpperCase())).map((row) => ({ id: row.id ?? null, name: row.fullName ?? row.name ?? null, role: roleLabel(row.roleKey), contact: row.phone ?? row.telephone ?? null }));
  }
  async function read(actor) {
    if (!canView(actor) || actor.schoolId !== schoolId) throw Object.assign(new Error('Forbidden.'), { status: 403 });
    const [settings, overview, leaders] = await Promise.all([schoolSettings.read(actor), singleSchoolOverview.getOverview(actor), leadership(actor)]);
    const profile = settings.profile ?? {};
    const info = asObject(settings.settings?.find?.((item) => item.key === 'schoolInformation')?.value ?? settings.profile?.schoolInformation);
    const year = settings.academicYears?.find((item) => item.isCurrent) ?? settings.academicYears?.[0] ?? null;
    const term = settings.terms?.find((item) => item.isCurrent) ?? settings.terms?.[0] ?? null;
    const merged = { ...info, ...profile };
    return clone({ schoolId, profile: { ...merged, name: merged.name ?? 'OSAAH DAYLIGHT SCHOOL', academicYear: year?.name ?? null, term: term?.name ?? null, status: merged.status ?? null, schoolType: merged.schoolType ?? null, educationalLevels: merged.educationalLevels ?? null, ownershipType: merged.ownershipType ?? null, yearEstablished: merged.yearEstablished ?? null, digitalAddress: merged.digitalAddress ?? null, postalAddress: merged.postalAddress ?? null, physicalAddress: merged.physicalAddress ?? merged.address ?? null, townCity: merged.townCity ?? null, district: merged.district ?? null, region: merged.region ?? null, country: merged.country ?? null, history: merged.history ?? null, vision: merged.vision ?? null, mission: merged.mission ?? null, coreValues: merged.coreValues ?? null }, leadership: leaders, academic: { currentAcademicYear: year?.name ?? null, currentTerm: term?.name ?? null, educationalLevels: merged.educationalLevels ?? null, classes: overview.students?.classBreakdown?.map((row) => row.name) ?? [] }, statistics: overview.overview ?? {}, calendar: { academicYear: year, term }, canEdit: canEdit(actor) });
  }
  function assertEdit(actor) { if (!canEdit(actor) || actor.schoolId !== schoolId) throw Object.assign(new Error('Forbidden.'), { status: 403 }); }
  return { read, canEdit, assertEdit };
}
