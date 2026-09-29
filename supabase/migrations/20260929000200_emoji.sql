-- =============================================================================
-- Sabai — V1.1: the picture staff recognise items by.
-- The POS is emoji-driven ("people remember a picture faster than a word"), and
-- the web app lets the owner pick one when adding a menu item or an ingredient.
-- Until now the API dropped it and the client guessed one from the name.
-- Nullable: rows created before this (and imports) keep the client's guess.
-- Menu categories already have `icon`, which carries theirs.
-- =============================================================================
alter table app.menu_items  add column emoji text check (emoji is null or length(emoji) between 1 and 16);
alter table app.ingredients add column emoji text check (emoji is null or length(emoji) between 1 and 16);
