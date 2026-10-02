-- The library (0089): where each book lives ("Maya's room") and who has it on loan (free text, since
-- books go to grandparents and friends as much as to family), dated when lent. Returning clears both.
ALTER TABLE library_books ADD COLUMN location TEXT;
ALTER TABLE library_books ADD COLUMN lent_to TEXT;
ALTER TABLE library_books ADD COLUMN lent_on TEXT;
