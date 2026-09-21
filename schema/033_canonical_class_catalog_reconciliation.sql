-- Part 9 focused class catalog reconciliation.
-- Inserts only missing canonical class master rows for the existing school.
-- Does not modify users, roles, students, payments, or fee structures.

INSERT IGNORE INTO classes (id, school_id, name, level, department_id, created_at)
VALUES
  ('class_nursery1_01', 'sch_default_01', 'Nursery 1', 'Nursery', NULL, CURRENT_TIMESTAMP),
  ('class_nursery2_01', 'sch_default_01', 'Nursery 2', 'Nursery', NULL, CURRENT_TIMESTAMP),
  ('class_kg1_01', 'sch_default_01', 'KG 1', 'KG', NULL, CURRENT_TIMESTAMP),
  ('class_kg2_01', 'sch_default_01', 'KG 2', 'KG', NULL, CURRENT_TIMESTAMP),
  ('class_bs2_01', 'sch_default_01', 'Basic 2', '2', NULL, CURRENT_TIMESTAMP),
  ('class_bs3_01', 'sch_default_01', 'Basic 3', '3', NULL, CURRENT_TIMESTAMP),
  ('class_bs4_01', 'sch_default_01', 'Basic 4', '4', NULL, CURRENT_TIMESTAMP),
  ('class_bs5_01', 'sch_default_01', 'Basic 5', '5', NULL, CURRENT_TIMESTAMP),
  ('class_bs6_01', 'sch_default_01', 'Basic 6', '6', NULL, CURRENT_TIMESTAMP),
  ('class_jhs1_01', 'sch_default_01', 'JHS 1', 'JHS', NULL, CURRENT_TIMESTAMP),
  ('class_jhs2_01', 'sch_default_01', 'JHS 2', 'JHS', NULL, CURRENT_TIMESTAMP),
  ('class_jhs3_01', 'sch_default_01', 'JHS 3', 'JHS', NULL, CURRENT_TIMESTAMP);
