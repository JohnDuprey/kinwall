-- "List updated" entries in the bell recorded before they linked to their list (url '/lists') now
-- open that list. The body is "<list name> has new items"; entries whose list is gone keep '/lists'.
UPDATE notifications
SET url = '/#/lists?list=' || (SELECT l.id FROM lists l WHERE l.name || ' has new items' = notifications.body ORDER BY l.archived, l.created_at LIMIT 1)
WHERE kind = 'list' AND url = '/lists'
  AND EXISTS (SELECT 1 FROM lists l WHERE l.name || ' has new items' = notifications.body);
