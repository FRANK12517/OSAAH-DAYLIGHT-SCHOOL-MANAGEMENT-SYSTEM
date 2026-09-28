const PROFILE_FIELDS = Object.freeze({
  name: 'name', motto: 'motto', address: 'address', telephone: 'telephone', email: 'email', website: 'website', logoPath: 'logo_path', primaryColour: 'primary_colour', secondaryColour: 'secondary_colour', accentColour: 'accent_colour'
});
const SETTING_KEYS = new Set(['academicYearId', 'termId', 'schoolInformation', 'resultConfiguration', 'communicationConfiguration']);
const clone = (value) => JSON.parse(JSON.stringify(value));
const validationError = (message) => Object.assign(new Error(message), { status: 400 });

export function createSchoolSettingsService({ database = null, schoolProfile = null, now = () => new Date().toISOString() } = {}) {
  const memory = new Map();
  function assertActor(actor) { if (!actor?.schoolId) throw Object.assign(new Error('Authenticated school context is required.'), { status: 403 }); return actor.schoolId; }
  function fallback(schoolId) {
    const existing = memory.get(schoolId) ?? { schoolId, name: schoolProfile?.name ?? schoolProfile?.schoolName ?? null, motto: schoolProfile?.motto ?? null, address: schoolProfile?.address ?? schoolProfile?.location ?? null, telephone: schoolProfile?.telephone ?? null, email: schoolProfile?.email ?? null, website: schoolProfile?.website ?? null, logoPath: schoolProfile?.logoPath ?? null, primaryColour: schoolProfile?.primaryColour ?? schoolProfile?.colours?.navy ?? null, secondaryColour: schoolProfile?.secondaryColour ?? schoolProfile?.colours?.royalBlue ?? null, accentColour: schoolProfile?.accentColour ?? schoolProfile?.colours?.gold ?? null };
    memory.set(schoolId, existing);
    return existing;
  }
  async function read(actor) {
    const schoolId = assertActor(actor);
    if (!database?.query) return publicView(fallback(schoolId));
    let school;
    try {
      const schools = await database.query('SELECT id,name,motto,address,telephone,email,website,logo_path AS logoPath,primary_colour AS primaryColour,secondary_colour AS secondaryColour,accent_colour AS accentColour,created_at AS createdAt,updated_at AS updatedAt FROM schools WHERE id=? LIMIT 1', [schoolId]);
      school = schools?.[0];
    } catch (error) {
      // Older production foundations may not yet have the optional branding columns.
      // Read the row through the database's deployed schema, then expose only the
      // canonical public profile fields below; authorization and school scope remain unchanged.
      const rows = await database.query('SELECT * FROM schools WHERE id=? LIMIT 1', [schoolId]);
      const row = rows?.[0];
      if (row) school = {
        id: row.id,
        name: row.name,
        motto: row.motto,
        address: row.address ?? null,
        telephone: row.telephone ?? null,
        email: row.email ?? null,
        website: row.website ?? null,
        logoPath: row.logoPath ?? row.logo_path ?? null,
        primaryColour: row.primaryColour ?? row.primary_colour ?? null,
        secondaryColour: row.secondaryColour ?? row.secondary_colour ?? null,
        accentColour: row.accentColour ?? row.accent_colour ?? null,
        createdAt: row.createdAt ?? row.created_at ?? null,
        updatedAt: row.updatedAt ?? row.updated_at ?? null
      };
      else if (error) throw error;
    }
    if (!school) throw Object.assign(new Error('Canonical OSAAH school record was not found.'), { status: 404 });
    const [settings, academicYears, terms] = await Promise.all([
      queryOptional('SELECT setting_key AS settingKey,setting_value AS settingValue,value_type AS valueType,updated_at AS updatedAt FROM system_settings WHERE school_id=? ORDER BY setting_key', 'SELECT setting_key AS settingKey,setting_value AS settingValue,value_type AS valueType,updated_at AS updatedAt FROM system_settings WHERE school_id=? ORDER BY setting_key', schoolId),
      queryOptional('SELECT id,name,starts_on AS startsOn,ends_on AS endsOn,is_current AS isCurrent FROM academic_years WHERE school_id=? ORDER BY starts_on DESC,id', 'SELECT id,name,starts_on AS startsOn,ends_on AS endsOn FROM academic_years WHERE school_id=? ORDER BY starts_on DESC,id', schoolId),
      queryOptional('SELECT t.id,t.academic_year_id AS academicYearId,t.name,t.starts_on AS startsOn,t.ends_on AS endsOn,t.is_current AS isCurrent FROM terms t JOIN academic_years y ON y.id=t.academic_year_id WHERE y.school_id=? ORDER BY t.starts_on DESC,t.id', 'SELECT t.id,t.academic_year_id AS academicYearId,t.name,t.starts_on AS startsOn,t.ends_on AS endsOn FROM terms t JOIN academic_years y ON y.id=t.academic_year_id WHERE y.school_id=? ORDER BY t.starts_on DESC,t.id', schoolId)
    ]);
    return publicView({ ...school, schoolId, settings: settings.map(parseSetting), academicYears, terms, updatedAt: school.updatedAt });
  }
  async function queryOptional(primarySql, fallbackSql, schoolId) {
    try {
      return await database.query(primarySql, [schoolId]);
    } catch {
      try {
        return await database.query(fallbackSql, [schoolId]);
      } catch {
        return [];
      }
    }
  }
  async function update(input, actor) {
    const schoolId = assertActor(actor);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw validationError('Settings payload must be an object.');
    const profileUpdates = Object.fromEntries(Object.entries(PROFILE_FIELDS).filter(([field]) => input[field] !== undefined).map(([field, column]) => [column, input[field] === null ? null : String(input[field]).trim()]));
    if (Object.prototype.hasOwnProperty.call(profileUpdates, 'name') && !profileUpdates.name) throw validationError('name is required.');
    const settingUpdates = Object.fromEntries(Object.entries(input).filter(([key]) => SETTING_KEYS.has(key)).map(([key, value]) => [key, value]));
    const allowed = new Set([...Object.keys(PROFILE_FIELDS), ...SETTING_KEYS]);
    if (Object.keys(input).some((key) => !allowed.has(key))) throw validationError('Unsupported school settings field.');
    if (!Object.keys(profileUpdates).length && !Object.keys(settingUpdates).length) throw validationError('At least one supported setting is required.');
    if (!database?.execute) {
      const current = fallback(schoolId); Object.assign(current, Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value]))); current.updatedAt = now(); return publicView(current);
    }
    const executeAll = async (db) => {
      if (Object.keys(profileUpdates).length) {
        const assignments = Object.keys(profileUpdates).map((column) => `${column}=?`).join(',');
        try {
          await db.execute(`UPDATE schools SET ${assignments},updated_at=? WHERE id=?`, [...Object.values(profileUpdates), now(), schoolId]);
        } catch {
          // Legacy production foundations may not have the optional timestamp column.
          await db.execute(`UPDATE schools SET ${assignments} WHERE id=?`, [...Object.values(profileUpdates), schoolId]);
        }
      }
      for (const [key, value] of Object.entries(settingUpdates)) await db.execute('INSERT INTO system_settings (id,school_id,setting_key,setting_value,value_type,is_sensitive,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),value_type=VALUES(value),updated_at=VALUES(updated_at)', [`setting-${schoolId}-${key}`, schoolId, key, typeof value === 'string' ? value : JSON.stringify(value), typeof value, now(), now()]);
    };
    if (database.transaction) await database.transaction(executeAll); else await executeAll(database);
    return read(actor);
  }
  function parseSetting(row) { let value = row.settingValue; if (row.valueType === 'number') value = Number(value); else if (row.valueType === 'boolean') value = value === 'true' || value === '1'; else if (row.valueType === 'object' || row.valueType === 'array') { try { value = JSON.parse(value); } catch {} } return { key: row.settingKey, value, updatedAt: row.updatedAt }; }
  function publicView(record) { const { schoolId, settings = [], academicYears = [], terms = [], ...profile } = record; return clone({ schoolId, profile, settings, academicYears, terms }); }
  return { read, update };
}
