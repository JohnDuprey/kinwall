-- Keep existing recipes and their references intact; NULL means a main dish.
ALTER TABLE recipes ADD COLUMN course TEXT CHECK(course IN ('side','dessert'));
