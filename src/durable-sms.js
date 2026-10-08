import { randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalRoleKey } from './auth.js';
import { normalizeGhanaPhone } from './ghana-phone.js';
import { isConfiguredTestStudentId, TEST_PARENT_ID, TEST_PARENT_PHONE } from './test-parent-fixture.js';

export const SMS_AUTHORIZED_ROLES = Object.freeze(['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER']);
export const SMS_CLASSES = Object.freeze(['Nursery 1', 'Nursery 2', 'KG 1', 'KG 2', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3']);
const SMS_ROLE_SET = new Set(SMS_AUTHORIZED_ROLES);
const fail = (message, status = 400, code = undefined) => { throw Object.assign(new Error(message), { status, code }); };
const idOf = (actor) => actor?.id ?? actor?.userId;
const str = (value) => String(value ?? '').trim();
const canonicalSmsClass = (value) => str(value).toUpperCase().replace(/\bBASIC\s*(\d+)\b/g, 'PRIMARY $1').replace(/\bKG\s*(\d+)\b/g, 'KG $1').replace(/\s+/g, ' ').trim();
const gsmBasic = /^[\u0000-\u007f£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,-.\/:;<=>?¡@£$¥¿ÄÖÑÜ§¿äöñüà^{}\\\[~\]|€]*$/u;

export function estimateSmsSegments(message) {
  const text = String(message ?? '');
  if (!text) return { characters: 0, encoding: 'GSM-7', segments: 0, perSegment: 160 };
  const gsm = gsmBasic.test(text);
  const units = gsm ? [...text].reduce((sum, char) => sum + ('^{}\\[]~|€'.includes(char) ? 2 : 1), 0) : [...text].length;
  const single = gsm ? 160 : 70;
  const multipart = gsm ? 153 : 67;
  return { characters: text.length, encoding: gsm ? 'GSM-7' : 'UCS-2', segments: units <= single ? 1 : Math.ceil(units / multipart), perSegment: units <= single ? single : multipart };
}

export function createArkeselGateway({ environment = process.env, fetchImpl = globalThis.fetch, clock = () => new Date().toISOString() } = {}) {
  const apiKey = str(environment.ARKESEL_API_KEY);
  const senderId = str(environment.ARKESEL_SENDER_ID);
  const callbackToken = str(environment.ARKESEL_CALLBACK_TOKEN);
  const nonProductionOptIn = str(environment.OSAAH_SMS_ALLOW_NONPRODUCTION).toLowerCase() === 'true';
  const productionEnvironment = str(environment.VERCEL_ENV).toLowerCase() === 'production';
  const costSetting = str(environment.ARKESEL_COST_PER_SEGMENT_GHS);
  const costPerSegmentGhs = costSetting && Number.isFinite(Number(costSetting)) && Number(costSetting) > 0 ? Number(costSetting) : null;
  const baseUrl = str(environment.PUBLIC_BASE_URL || (environment.VERCEL_URL ? `https://${environment.VERCEL_URL}` : 'https://www.osaahdaylightschool.online')).replace(/\/$/, '');
  const configured = Boolean(apiKey && senderId && senderId.length <= 11 && callbackToken && fetchImpl && (productionEnvironment || nonProductionOptIn));
  async function send({ message, recipients }) {
    if (!configured) fail('SMS provider is not configured. Set the protected Arkesel API key, sender ID, and delivery callback token.', 503, 'SMS_PROVIDER_NOT_CONFIGURED');
    const callback = new URL('/api/sms/delivery-callback', baseUrl);
    callback.searchParams.set('token', callbackToken);
    const response = await fetchImpl('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({ sender: senderId, message, recipients, callback_url: callback.toString() })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || String(body.status ?? '').toLowerCase() !== 'success') fail('SMS provider did not accept the submission.', 502, 'SMS_PROVIDER_REJECTED');
    return body.data;
  }
  function validateCallbackToken(value) {
    const supplied = Buffer.from(str(value)); const expected = Buffer.from(callbackToken);
    return Boolean(callbackToken && supplied.length === expected.length && timingSafeEqual(supplied, expected));
  }
  return Object.freeze({ provider: 'ARKESEL', configured, send, validateCallbackToken, callbackBaseUrl: baseUrl, costPerSegmentGhs, checkedAt: clock() });
}

export function createDurableSmsService({ database, schoolId, gateway = createArkeselGateway(), clock = () => new Date().toISOString(), audit = () => {} } = {}) {
  if (!database?.query || !database?.execute || !database?.transaction) throw new TypeError('A durable database adapter is required for SMS.');
  const assertActor = (actor) => {
    if (!actor || actor.schoolId !== schoolId) fail('School scope denied.', 403);
    if (!SMS_ROLE_SET.has(canonicalRoleKey(actor.roleKey)) || !(actor.permissions?.has?.('messages.sms.send') || actor.permissions?.has?.('*'))) fail('SMS sending requires messages.sms.send.', 403);
  };
  const fields = `psl.parent_user_id AS parentId,COALESCE(NULLIF(u.username,''),NULLIF(u.email,''),u.id) AS parentName,psl.telephone AS telephone,sp.id AS profileId,sp.class_id AS classId,c.name AS className,s.id AS studentId,s.permanent_student_id AS permanentStudentId`;
  const linkedStudentQuery = `SELECT DISTINCT ${fields}
    FROM parent_student_links psl
    JOIN users u ON u.id=psl.parent_user_id AND u.school_id=? AND UPPER(COALESCE(u.status,'ACTIVE'))='ACTIVE'
    JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.role_key='PARENT'
    JOIN student_profiles sp ON sp.id=psl.student_id AND sp.school_id=u.school_id
    JOIN students s ON s.id=sp.student_master_id AND s.school_id=u.school_id
    LEFT JOIN classes c ON c.id=sp.class_id
    WHERE psl.link_status='ACTIVE' AND s.school_id=? AND COALESCE(s.is_test_record,0)=0
      AND COALESCE(s.student_status,'ACTIVE') NOT IN ('WITHDRAWN','TRANSFERRED','COMPLETED','GRADUATED')
      AND u.id<>? AND COALESCE(psl.telephone,'')<>''`;
  function normalizeRecipients(rows) {
    const found = new Map();
    for (const item of rows) {
      if (!item || item.parentId === TEST_PARENT_ID || isConfiguredTestStudentId(item.permanentStudentId)) continue;
      const phone = normalizeGhanaPhone(item.telephone);
      if (!phone || phone === TEST_PARENT_PHONE || found.has(phone)) continue;
      found.set(phone, { parentId: String(item.parentId), parentName: String(item.parentName ?? item.parentId), phone, studentId: item.studentId ?? null, classId: item.classId ?? null, className: item.className ?? null });
    }
    return [...found.values()];
  }
  async function resolveRecipients(input, actor) {
    assertActor(actor);
    const mode = str(input?.recipientMode ?? input?.audience).toUpperCase();
    if (!['INDIVIDUAL_PARENT', 'SELECTED_PARENTS', 'ALL_PARENTS', 'PARENTS_BY_CLASS'].includes(mode)) fail('Choose a valid parent recipient group.');
    const ids = [...new Set((Array.isArray(input?.parentIds) ? input.parentIds : input?.parentId ? [input.parentId] : []).map(str).filter(Boolean))];
    if (mode === 'INDIVIDUAL_PARENT' && ids.length !== 1) fail('Choose exactly one parent.');
    if (mode === 'SELECTED_PARENTS' && ids.length < 1) fail('Choose at least one parent.');
    if (mode === 'PARENTS_BY_CLASS') {
      const className = str(input.className);
      const academicYearId = str(input.academicYearId);
      const termId = str(input.termId);
      if (!SMS_CLASSES.includes(className) || !academicYearId || !termId) fail('Choose a class, academic year, and term.');
      const context = await database.query('SELECT ay.id AS academicYearId,t.id AS termId FROM academic_years ay JOIN terms t ON t.academic_year_id=ay.id WHERE ay.school_id=? AND ay.id=? AND t.id=? LIMIT 1', [schoolId, academicYearId, termId]);
      if (!context.length) fail('The selected academic context is not valid for this school.', 400);
      const rows = await database.query(`${linkedStudentQuery}
        AND EXISTS (SELECT 1 FROM student_enrollments e WHERE e.student_id=s.id AND e.school_id=s.school_id AND e.academic_year_id=? AND e.term_id=? AND e.class_id=sp.class_id AND e.is_current=1 AND UPPER(COALESCE(e.enrollment_status,'ACTIVE')) NOT IN ('WITHDRAWN','TRANSFERRED','COMPLETED','GRADUATED'))
        ORDER BY psl.parent_user_id,s.id`, [schoolId, schoolId, TEST_PARENT_ID, academicYearId, termId]);
      const inClass = rows.filter((row) => canonicalSmsClass(row.className) === canonicalSmsClass(className));
      return { mode, recipients: normalizeRecipients(inClass), context: { className, academicYearId, termId } };
    }
    const base = await database.query(`${linkedStudentQuery}${mode === 'ALL_PARENTS' ? '' : ` AND psl.parent_user_id IN (${ids.map(() => '?').join(',')})`} ORDER BY psl.parent_user_id,s.id`, [schoolId, schoolId, TEST_PARENT_ID, ...(mode === 'ALL_PARENTS' ? [] : ids)]);
    const recipients = normalizeRecipients(base);
    if (ids.length && recipients.some((item) => !ids.includes(item.parentId))) fail('A requested parent is outside the eligible school roster.', 403);
    if (!recipients.length) return { mode, recipients: [], context: null };
    if (ids.length) {
      const resolvedIds = new Set(recipients.map((item) => item.parentId));
      for (const id of ids) if (!resolvedIds.has(id)) fail('One or more selected parents have no eligible registered Ghana mobile number.', 400);
    }
    return { mode, recipients, context: null };
  }
  async function options(actor) {
    assertActor(actor);
    const [parents, contexts] = await Promise.all([
      database.query(`SELECT DISTINCT u.id AS id,COALESCE(NULLIF(u.username,''),NULLIF(u.email,''),u.id) AS name
        FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.role_key='PARENT'
        JOIN parent_student_links psl ON psl.parent_user_id=u.id AND psl.link_status='ACTIVE'
        JOIN student_profiles sp ON sp.id=psl.student_id AND sp.school_id=u.school_id
        JOIN students s ON s.id=sp.student_master_id AND s.school_id=u.school_id
        WHERE u.school_id=? AND UPPER(COALESCE(u.status,'ACTIVE'))='ACTIVE' AND COALESCE(s.is_test_record,0)=0 AND u.id<>? AND COALESCE(psl.telephone,'')<>'' ORDER BY name,u.id`, [schoolId, TEST_PARENT_ID]),
      database.query('SELECT ay.id AS academicYearId,ay.name AS academicYearName,t.id AS termId,t.name AS termName FROM academic_years ay JOIN terms t ON t.academic_year_id=ay.id WHERE ay.school_id=? ORDER BY ay.is_current DESC,ay.starts_on DESC,t.is_current DESC,t.starts_on DESC', [schoolId])
    ]);
    return { parents, classes: [...SMS_CLASSES], academicContexts: contexts, provider: { name: gateway.provider ?? null, configured: Boolean(gateway.configured) } };
  }
  function cleanSelector(input) {
    return { recipientMode: str(input.recipientMode ?? input.audience).toUpperCase(), parentIds: [...new Set((Array.isArray(input.parentIds) ? input.parentIds : input.parentId ? [input.parentId] : []).map(str).filter(Boolean))], className: str(input.className) || null, academicYearId: str(input.academicYearId) || null, termId: str(input.termId) || null };
  }
  function validateMessage(input) {
    const message = str(input?.message ?? input?.body);
    if (!message) fail('SMS message is required.');
    if ([...message].length > 1600) fail('SMS message must be 1,600 characters or fewer.');
    return message;
  }
  async function preview(input, actor) {
    assertActor(actor);
    const message = validateMessage(input);
    const selection = await resolveRecipients(input, actor);
    const estimate = estimateSmsSegments(message);
    const totalEstimatedSegments = estimate.segments * selection.recipients.length;
    const estimatedCost = Number.isFinite(gateway?.costPerSegmentGhs) && gateway.costPerSegmentGhs > 0 ? Math.round(totalEstimatedSegments * gateway.costPerSegmentGhs * 100) / 100 : null;
    return { message, ...estimate, recipientCount: selection.recipients.length, totalEstimatedSegments, recipients: selection.recipients.map(({ parentId, parentName, className }) => ({ parentId, parentName, className })), recipientMode: selection.mode, context: selection.context, estimatedCost, costCurrency: estimatedCost === null ? null : 'GHS' };
  }
  const asCampaign = (row) => ({ id: row.id, status: row.status, message: row.message_body, recipientMode: row.recipient_mode, selector: (() => { try { return row.selector_json ? JSON.parse(row.selector_json) : null; } catch { return null; } })(), recipients: Number(row.recipient_count ?? 0), createdAt: row.created_at, updatedAt: row.updated_at, sentAt: row.sent_at ?? null, provider: row.provider_key ?? null });
  async function saveDraft(input, actor) {
    assertActor(actor);
    const message = validateMessage(input);
    const selector = cleanSelector(input);
    if (!['INDIVIDUAL_PARENT','SELECTED_PARENTS','ALL_PARENTS','PARENTS_BY_CLASS'].includes(selector.recipientMode)) fail('Choose a valid parent recipient group.');
    const now = clock();
    const id = str(input.id) || randomUUID();
    const existing = await database.query('SELECT id,created_by,status FROM sms_campaigns WHERE id=? AND school_id=? LIMIT 1', [id, schoolId]);
    if (existing.length && (existing[0].created_by !== idOf(actor) || existing[0].status !== 'DRAFT')) fail('Only the author can edit an unsent draft.', 403);
    if (existing.length) {
      await database.execute('UPDATE sms_campaigns SET message_body=?,recipient_mode=?,selector_json=?,updated_at=? WHERE id=? AND school_id=? AND status=\'DRAFT\'', [message, selector.recipientMode, JSON.stringify(selector), now, id, schoolId]);
    } else {
      await database.execute('INSERT INTO sms_campaigns (id,school_id,message_body,recipient_mode,selector_json,status,recipient_count,created_by,idempotency_key,provider_key,created_at,updated_at,sent_at) VALUES (?,?,?,?,?,\'DRAFT\',0,?,NULL,NULL,?,?,NULL)', [id, schoolId, message, selector.recipientMode, JSON.stringify(selector), idOf(actor), now, now]);
    }
    audit({ schoolId, userId: idOf(actor), action: 'SMS_DRAFT_SAVED', entity: 'SmsCampaign', entityId: id });
    return { id, status: 'DRAFT', message, recipientMode: selector.recipientMode, updatedAt: now };
  }
  async function listHistory(actor) {
    assertActor(actor);
    const rows = await database.query('SELECT id,status,message_body,recipient_mode,selector_json,recipient_count,created_at,updated_at,sent_at,provider_key FROM sms_campaigns WHERE school_id=? ORDER BY updated_at DESC,id DESC LIMIT 100', [schoolId]);
    return rows.map(asCampaign);
  }
  async function send(input, actor) {
    assertActor(actor);
    if (input?.confirm !== true) fail('Explicit confirmation is required before sending SMS.', 400, 'SMS_CONFIRMATION_REQUIRED');
    const message = validateMessage(input);
    const idempotencyKey = str(input.idempotencyKey);
    if (!idempotencyKey || idempotencyKey.length > 128) fail('A valid idempotency key is required.');
    const existing = await database.query('SELECT id,status,message_body,recipient_mode,recipient_count,created_at,updated_at,sent_at,provider_key FROM sms_campaigns WHERE school_id=? AND idempotency_key=? LIMIT 1', [schoolId, idempotencyKey]);
    if (existing.length) return { ...asCampaign(existing[0]), duplicate: true };
    if (!gateway?.configured || typeof gateway.send !== 'function') fail('SMS provider is not configured; the message was not queued or sent.', 503, 'SMS_PROVIDER_NOT_CONFIGURED');
    const selection = await resolveRecipients(input, actor);
    if (!selection.recipients.length) fail('No eligible parent recipients were found; nothing was sent.', 400, 'SMS_EMPTY_RECIPIENTS');
    const id = randomUUID(); const now = clock(); const selector = cleanSelector(input);
    await database.transaction(async (tx) => {
      await tx.execute('INSERT INTO sms_campaigns (id,school_id,message_body,recipient_mode,selector_json,status,recipient_count,created_by,idempotency_key,provider_key,created_at,updated_at,sent_at) VALUES (?,?,?,?,?,\'QUEUED\',?,?,?,?,?,?,NULL)', [id, schoolId, message, selection.mode, JSON.stringify(selector), selection.recipients.length, idOf(actor), idempotencyKey, gateway.provider ?? 'UNKNOWN', now, now]);
      for (const recipient of selection.recipients) await tx.execute('INSERT INTO sms_campaign_recipients (id,school_id,campaign_id,parent_user_id,student_id,normalized_phone,recipient_name,status,provider_message_id,last_error,created_at,updated_at,delivered_at) VALUES (?,?,?,?,?,?,?,\'QUEUED\',NULL,NULL,?,?,NULL)', [randomUUID(), schoolId, id, recipient.parentId, recipient.studentId, recipient.phone, recipient.parentName, now, now]);
    });
    let providerRows;
    try {
      providerRows = await gateway.send({ message, recipients: selection.recipients.map((item) => item.phone) });
      const refs = Array.isArray(providerRows) ? providerRows : providerRows && typeof providerRows === 'object' ? [providerRows] : [];
      for (const recipient of selection.recipients) {
        const match = refs.find((ref) => normalizeGhanaPhone(ref.recipient ?? ref.phone) === recipient.phone) ?? (refs.length === 1 ? refs[0] : null);
        await database.execute('UPDATE sms_campaign_recipients SET status=\'SENT\',provider_message_id=?,updated_at=? WHERE school_id=? AND campaign_id=? AND normalized_phone=?', [match?.id ?? match?.messageId ?? null, clock(), schoolId, id, recipient.phone]);
      }
      const sentAt = clock();
      await database.execute('UPDATE sms_campaigns SET status=\'SENT\',sent_at=?,updated_at=? WHERE school_id=? AND id=?', [sentAt, sentAt, schoolId, id]);
      audit({ schoolId, userId: idOf(actor), action: 'SMS_SUBMITTED', entity: 'SmsCampaign', entityId: id, recipients: selection.recipients.length, provider: gateway.provider ?? 'UNKNOWN' });
      return { id, status: 'SENT', message, recipientMode: selection.mode, recipients: selection.recipients.length, sentAt, provider: gateway.provider ?? null, deliveryStatus: 'PENDING_PROVIDER_CONFIRMATION', duplicate: false };
    } catch (error) {
      const safeError = error?.code === 'SMS_PROVIDER_REJECTED' ? 'Provider rejected the SMS submission.' : 'SMS provider submission failed.';
      await database.execute('UPDATE sms_campaign_recipients SET status=\'FAILED\',last_error=?,updated_at=? WHERE school_id=? AND campaign_id=? AND status=\'QUEUED\'', [safeError, clock(), schoolId, id]);
      await database.execute('UPDATE sms_campaigns SET status=\'FAILED\',updated_at=? WHERE school_id=? AND id=?', [clock(), schoolId, id]);
      audit({ schoolId, userId: idOf(actor), action: 'SMS_SUBMISSION_FAILED', entity: 'SmsCampaign', entityId: id });
      return { id, status: 'FAILED', message, recipientMode: selection.mode, recipients: selection.recipients.length, provider: gateway.provider ?? null, error: safeError, duplicate: false };
    }
  }
  async function deliveryCallback({ token, smsId, status } = {}) {
    if (!gateway?.validateCallbackToken?.(token)) fail('Invalid provider callback.', 401);
    const providerStatus = str(status).toUpperCase();
    const mapped = providerStatus === 'DELIVERED' ? 'DELIVERED' : ['NOT_DELIVERED','PROHIBITED','EXPIRED','FAILED'].includes(providerStatus) ? 'FAILED' : ['SUBMITTED','QUEUED'].includes(providerStatus) ? 'SENT' : null;
    if (!smsId || !mapped) fail('Unsupported provider delivery status.', 400);
    const rows = await database.query('SELECT id,campaign_id FROM sms_campaign_recipients WHERE school_id=? AND provider_message_id=? LIMIT 1', [schoolId, str(smsId)]);
    if (!rows.length) return { accepted: false };
    const now = clock();
    await database.execute('UPDATE sms_campaign_recipients SET status=?,last_error=?,delivered_at=?,updated_at=? WHERE school_id=? AND id=?', [mapped, mapped === 'FAILED' ? `Provider status: ${providerStatus}` : null, mapped === 'DELIVERED' ? now : null, now, schoolId, rows[0].id]);
    const summary = await database.query('SELECT COUNT(*) AS total,SUM(status=\'DELIVERED\') AS delivered,SUM(status=\'FAILED\') AS failed,SUM(status IN (\'QUEUED\',\'SENT\')) AS pending FROM sms_campaign_recipients WHERE school_id=? AND campaign_id=?', [schoolId, rows[0].campaign_id]);
    const counts = summary[0] ?? {};
    const campaignStatus = Number(counts.pending ?? 0) > 0 ? 'SENT' : Number(counts.failed ?? 0) > 0 ? Number(counts.delivered ?? 0) > 0 ? 'PARTIALLY_DELIVERED' : 'FAILED' : 'DELIVERED';
    await database.execute('UPDATE sms_campaigns SET status=?,updated_at=? WHERE school_id=? AND id=?', [campaignStatus, now, schoolId, rows[0].campaign_id]);
    audit({ schoolId, action: 'SMS_DELIVERY_STATUS', entity: 'SmsCampaignRecipient', entityId: rows[0].id, status: mapped });
    return { accepted: true, status: mapped };
  }
  async function getHistoryItem(id, actor) {
    assertActor(actor);
    const rows = await database.query('SELECT id,status,message_body,recipient_mode,selector_json,recipient_count,created_at,updated_at,sent_at,provider_key FROM sms_campaigns WHERE school_id=? AND id=? LIMIT 1', [schoolId, id]);
    if (!rows.length) return null;
    const recipients = await database.query('SELECT recipient_name AS name,normalized_phone AS phone,status,provider_message_id AS providerMessageId,last_error AS error,created_at AS createdAt,updated_at AS updatedAt,delivered_at AS deliveredAt FROM sms_campaign_recipients WHERE school_id=? AND campaign_id=? ORDER BY created_at, id', [schoolId, id]);
    return { ...asCampaign(rows[0]), recipients };
  }
  return Object.freeze({ options, preview, saveDraft, send, listHistory, getHistoryItem, deliveryCallback, resolveRecipients });
}
