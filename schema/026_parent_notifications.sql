CREATE INDEX IF NOT EXISTS idx_parent_student_links_parent ON parent_student_links(parent_user_id, student_id);
CREATE INDEX IF NOT EXISTS idx_notifications_student_created ON notifications(school_id, student_id, created_at);
