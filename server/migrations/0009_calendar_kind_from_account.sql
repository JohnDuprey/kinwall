-- Calendars added from a Google/Outlook account through the Settings picker were saved as 'caldav'
-- (the picker hardcoded it), so their syncs failed with "Invalid URL string". A calendar that belongs
-- to an account always uses that account's provider.
UPDATE calendars
SET kind = (SELECT a.kind FROM accounts a WHERE a.id = calendars.account_id), last_error = NULL
WHERE account_id IS NOT NULL
  AND kind <> (SELECT a.kind FROM accounts a WHERE a.id = calendars.account_id);
