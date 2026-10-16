-- Remote moved from a pilot's locations to its work modes: "Remote · Canada" becomes the
-- location Canada plus remote work, and a bare "Remote" becomes remote work alone.
UPDATE "pilots" p
SET "rules" = jsonb_set(
  jsonb_set(
    p."rules",
    '{locations}',
    (
      SELECT COALESCE(jsonb_agg(DISTINCT place), '[]'::jsonb)
      FROM (
        SELECT CASE
          WHEN location ~* '^remote' THEN NULLIF(btrim(split_part(location, '·', 2)), '')
          ELSE location
        END AS place
        FROM jsonb_array_elements_text(p."rules" -> 'locations') AS location
      ) places
      WHERE place IS NOT NULL
    )
  ),
  '{workModes}',
  (
    SELECT jsonb_agg(DISTINCT mode)
    FROM (
      SELECT jsonb_array_elements_text(COALESCE(p."rules" -> 'workModes', '[]'::jsonb)) AS mode
      UNION
      SELECT 'remote'
    ) modes
  )
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text(p."rules" -> 'locations') AS location
  WHERE location ~* '^remote'
);
