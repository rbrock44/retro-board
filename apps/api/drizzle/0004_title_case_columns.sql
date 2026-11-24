-- Built-in column titles became Title Case ("Went well" -> "Went Well"); bring existing boards along.
UPDATE "columns" SET "title" = CASE "title"
  WHEN 'Went well' THEN 'Went Well'
  WHEN 'To improve' THEN 'To Improve'
  WHEN 'Action ideas' THEN 'Action Ideas'
  WHEN 'Longed for' THEN 'Longed For'
  WHEN 'Carried over' THEN 'Carried Over'
END
WHERE "title" IN ('Went well', 'To improve', 'Action ideas', 'Longed for', 'Carried over');
