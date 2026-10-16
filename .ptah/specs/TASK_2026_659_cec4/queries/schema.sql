SELECT name, sql FROM sqlite_master WHERE type='table' AND (name LIKE 'skill%' OR name IN ('job_runs','scheduled_jobs','session_organization','observation_queue')) AND name NOT LIKE '%vec%';
SELECT name, (SELECT COUNT(*) FROM pragma_table_info(name)) c FROM sqlite_master WHERE type='table' AND name LIKE 'skill%' AND name NOT LIKE '%vec%';
