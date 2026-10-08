import { randomUUID } from 'node:crypto';

const CREATOR_ROLES = new Set(['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER']);
const CATEGORIES = new Set(['INDIVIDUAL_TEACHER', 'SELECTED_TEACHERS', 'ALL_TEACHERS', 'INDIVIDUAL_STAFF', 'SELECTED_STAFF', 'ALL_STAFF', 'INDIVIDUAL_PARENT', 'SELECTED_PARENTS', 'ALL_PARENTS']);
const row = (rows) => rows?.[0] ?? null;
const actorId = (actor) => actor?.id ?? actor?.userId;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export function createDurableAnnouncementsService({ database, schoolId, clock = () => new Date().toISOString(), audit = () => {} } = {}) {
  if (!database?.query || !database?.execute) throw new TypeError('A durable database adapter is required.');
  const assertSchool = (actor) => { if (!actor || actor.schoolId !== schoolId) fail('School scope denied.', 403); };
  const assertCreator = (actor) => { assertSchool(actor); if (!CREATOR_ROLES.has(String(actor.roleKey).toUpperCase()) && !actor.permissions?.has?.('*') && !actor.permissions?.has?.('announcements.create')) fail('Announcement creation requires announcements.create.', 403); };
  async function options(actor) {
    assertCreator(actor);
    const [teachers, staff, parents] = await Promise.all([
      database.query("SELECT u.id AS id,TRIM(CONCAT_WS(' ',s.first_name,s.last_name)) AS name FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id LEFT JOIN staff s ON s.user_id=u.id AND s.school_id=u.school_id WHERE u.school_id=? AND u.status='ACTIVE' AND r.role_key='TEACHER' ORDER BY name,u.id", [schoolId]),
      database.query("SELECT u.id AS id,COALESCE(NULLIF(TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),''),u.username) AS name,r.role_key AS roleKey FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id LEFT JOIN staff s ON s.user_id=u.id AND s.school_id=u.school_id WHERE u.school_id=? AND u.status='ACTIVE' AND r.role_key NOT IN ('PARENT','TEACHER','PROPRIETOR','SCHOOL_ADMIN','HEADTEACHER','ASSISTANT_HEADTEACHER') ORDER BY name,u.id", [schoolId]),
      database.query("SELECT DISTINCT u.id AS id,COALESCE(NULLIF(u.username,''),u.email,u.id) AS name FROM users u JOIN parent_student_links p ON p.parent_user_id=u.id WHERE u.school_id=? AND u.status='ACTIVE' ORDER BY name,u.id", [schoolId])
    ]);
    return { teachers, staff, parents };
  }
  async function resolveRecipients(input, actor) {
    assertCreator(actor);
    const category = String(input.recipientCategory ?? input.audience ?? '').toUpperCase();
    if (!CATEGORIES.has(category)) fail('A valid recipient category is required.');
    const ids = [...new Set((input.recipientIds ?? input.userIds ?? []).map(String).filter(Boolean))];
    if ((category.startsWith('INDIVIDUAL_') && ids.length !== 1) || (category.startsWith('SELECTED_') && !ids.length)) fail('Recipient selection does not match the category.');
    let query = "SELECT DISTINCT u.id AS userId,CASE WHEN r.role_key='PARENT' THEN 'PARENT' WHEN r.role_key='TEACHER' THEN 'TEACHER' ELSE 'STAFF' END AS recipientType FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.school_id=? AND u.status='ACTIVE' AND r.role_key NOT IN ('STUDENT')";
    const params = [schoolId];
    if (category.includes('TEACHER')) query += " AND r.role_key='TEACHER'";
    else if (category.includes('STAFF')) query += " AND r.role_key NOT IN ('PARENT','TEACHER','PROPRIETOR','SCHOOL_ADMIN','HEADTEACHER','ASSISTANT_HEADTEACHER')";
    else if (category.includes('PARENT')) query += " AND r.role_key='PARENT'";
    if (ids.length && !category.startsWith('ALL_')) { query += ` AND u.id IN (${ids.map(() => '?').join(',')})`; params.push(...ids); }
    const recipients = await database.query(query, params);
    if (ids.length && recipients.length !== ids.length) fail('One or more recipients are outside the school or category.', 403);
    if (!recipients.length) fail('No eligible recipients were found.');
    return recipients;
  }
  const mapAnnouncement = (r) => ({ id: r.id, schoolId: r.schoolId, title: r.title, message: r.message, priority: r.priority, status: r.status, recipientCategory: r.recipientCategory, scheduledFor: r.scheduledFor, publishedAt: r.publishedAt, createdAt: r.createdAt, senderId: r.senderId, senderName: r.senderName, senderRole: r.senderRole, read: Boolean(r.readAt) });
  async function create(input, actor) {
    assertCreator(actor);
    const title = String(input.title ?? '').trim(); const message = String(input.message ?? input.body ?? '').trim();
    if (!title || !message) fail('Announcement title and message are required.');
    const status = input.status === 'DRAFT' ? 'DRAFT' : input.scheduledFor ? 'SCHEDULED' : 'PUBLISHED';
    if (status === 'SCHEDULED' && (!Number.isFinite(Date.parse(input.scheduledFor)) || Date.parse(input.scheduledFor) <= Date.now())) fail('Scheduled publication must be in the future.');
    const recipients = status === 'DRAFT' ? [] : await resolveRecipients(input, actor);
    const id = randomUUID(); const now = clock(); const publishedAt = status === 'PUBLISHED' ? now : null;
    await database.transaction(async (tx) => {
      await tx.execute('INSERT INTO announcement_records (id,school_id,title,message,priority,recipient_category,status,scheduled_for,published_at,sender_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [id, schoolId, title, message, input.priority ?? 'NORMAL', String(input.recipientCategory ?? input.audience ?? 'ALL_PARENTS').toUpperCase(), status, input.scheduledFor ?? null, publishedAt, actorId(actor), now, now]);
      for (const recipient of recipients) await tx.execute('INSERT INTO announcement_recipients (id,school_id,announcement_id,recipient_id,recipient_type,assigned_at) VALUES (?,?,?,?,?,?)', [randomUUID(), schoolId, id, recipient.userId, recipient.recipientType, now]);
    });
    audit({ schoolId, userId: actorId(actor), action: status === 'PUBLISHED' ? 'ANNOUNCEMENT_PUBLISHED' : 'ANNOUNCEMENT_CREATED', entity: 'Announcement', entityId: id });
    return { id, title, message, priority: input.priority ?? 'NORMAL', status, scheduledFor: input.scheduledFor ?? null, publishedAt, recipients: recipients.length };
  }
  async function list(actor) {
    assertSchool(actor);
    const params = [schoolId, actorId(actor)];
    const result = await database.query(`SELECT a.id,a.school_id AS schoolId,a.title,a.message,a.priority,a.recipient_category AS recipientCategory,a.status,a.scheduled_for AS scheduledFor,a.published_at AS publishedAt,a.sender_id AS senderId,a.created_at AS createdAt,u.username AS senderName,r.role_key AS senderRole,ar.read_at AS readAt FROM announcement_records a JOIN users u ON u.id=a.sender_id LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id LEFT JOIN announcement_recipients rec ON rec.announcement_id=a.id AND rec.recipient_id=? LEFT JOIN announcement_reads ar ON ar.announcement_id=a.id AND ar.recipient_id=? WHERE a.school_id=? AND ((a.status IN ('PUBLISHED','SCHEDULED') AND rec.recipient_id IS NOT NULL) OR a.sender_id=?) ORDER BY COALESCE(a.published_at,a.created_at) DESC`, [schoolId, actorId(actor), actorId(actor), actorId(actor)]);
    return result.map(mapAnnouncement);
  }
  async function markRead(id, actor) { assertSchool(actor); const existing = row(await database.query('SELECT id FROM announcement_recipients WHERE school_id=? AND announcement_id=? AND recipient_id=?', [schoolId, id, actorId(actor)])); if (!existing) fail('Announcement not found.', 404); const now = clock(); await database.execute('INSERT INTO announcement_reads (id,school_id,announcement_id,recipient_id,read_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE read_at=VALUES(read_at)', [randomUUID(), schoolId, id, actorId(actor), now]); return { ok: true, readAt: now }; }
  async function publishDue(actor = { id: 'scheduler', schoolId }) { assertSchool(actor); const due = await database.query("SELECT id FROM announcement_records WHERE school_id=? AND status='SCHEDULED' AND scheduled_for<=?", [schoolId, clock()]); for (const item of due) await database.execute("UPDATE announcement_records SET status='PUBLISHED',published_at=?,updated_at=? WHERE school_id=? AND id=? AND status='SCHEDULED'", [clock(), clock(), schoolId, item.id]); return { published: due.length }; }
  return { options, create, list, markRead, publishDue };
}
export { CREATOR_ROLES };
