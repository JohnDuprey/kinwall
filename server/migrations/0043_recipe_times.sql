-- How long a recipe takes (a meal kit's card prints both): minutes of hands-on prep and in total.
ALTER TABLE recipes ADD COLUMN prep_minutes INTEGER;
ALTER TABLE recipes ADD COLUMN total_minutes INTEGER;
