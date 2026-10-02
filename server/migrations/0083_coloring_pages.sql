-- Paint's coloring book (routes/photos.ts): a page a parent added from a picture, stored as line art
-- (a PNG) next to the photos so it shares their size limits, image route and zip backup. Stored with
-- family = 0 so it stays off the Photos page, the Board, the screensaver and Newscast.
ALTER TABLE photos ADD COLUMN coloring INTEGER NOT NULL DEFAULT 0;
