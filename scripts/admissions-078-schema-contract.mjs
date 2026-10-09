export const EXPECTED_ADMISSIONS_078_COLUMNS = Object.freeze([
  Object.freeze({
    table: 'admission_applications',
    name: 'enquiry_request_id',
    preferredType: 'varchar(64)',
    compatibleTypes: Object.freeze(['varchar(64)']),
    nullable: 'YES'
  }),
  Object.freeze({
    table: 'admission_applications',
    name: 'permanent_student_id',
    preferredType: 'varchar(128)',
    // The canonical master ID is VARCHAR(100); this field stores the same ID.
    // Keep 128 for new installations, but accept 100 as a proven compatible legacy width.
    compatibleTypes: Object.freeze(['varchar(100)', 'varchar(128)']),
    nullable: 'YES'
  })
]);

const contractsByColumn = new Map(EXPECTED_ADMISSIONS_078_COLUMNS.map((contract) => [`${contract.table}.${contract.name}`, contract]));

export function columnDefinitionMismatch(table, name, actual) {
  const contract = contractsByColumn.get(`${table}.${name}`);
  if (!contract || !actual) return null;
  const actualType = String(actual.type ?? '').toLowerCase();
  const actualNullable = String(actual.nullable ?? '').toUpperCase();
  if (contract.compatibleTypes.includes(actualType) && contract.nullable === actualNullable) return null;
  return {
    table,
    name,
    expectedType: contract.preferredType,
    expectedTypes: [...contract.compatibleTypes],
    expectedNullable: contract.nullable,
    actualType,
    actualNullable
  };
}
