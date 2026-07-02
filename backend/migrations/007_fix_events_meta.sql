-- 007: repair double-encoded events.meta.
-- app/db/events.py used to json.dumps() the meta dict before binding it to a
-- jsonb parameter whose codec json.dumps()-es again, so every row stored a
-- JSON *string scalar* ('"{\"k\": 1}"') instead of an object — meta->>'key'
-- returned NULL everywhere. Re-parse the inner string back into an object.
UPDATE events
SET meta = (meta #>> '{}')::jsonb
WHERE jsonb_typeof(meta) = 'string';
