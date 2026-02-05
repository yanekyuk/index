-- Rename personal index title from "Everything" to "My Own Private Index"
UPDATE indexes
SET title = 'My Own Private Index'
WHERE is_personal = true AND title = 'Everything';
