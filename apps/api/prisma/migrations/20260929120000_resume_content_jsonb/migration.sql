-- Content moves from text to jsonb, and every entry gets the id the web editor would have given it,
-- replacing the backfill the API used to run on each read.
ALTER TABLE "resumes" ALTER COLUMN "content" TYPE JSONB USING "content"::jsonb;
ALTER TABLE "resume_variants" ALTER COLUMN "content" TYPE JSONB USING "content"::jsonb;
ALTER TABLE "resume_variants" ALTER COLUMN "rewrites" TYPE JSONB USING "rewrites"::jsonb;

CREATE FUNCTION pg_temp.with_ids(items JSONB, prefix TEXT) RETURNS JSONB AS $$
  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN COALESCE(item->>'id', '') <> '' THEN item
        ELSE item || jsonb_build_object('id', prefix || '_' || gen_random_uuid())
      END
      ORDER BY position
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(COALESCE(items, '[]'::jsonb)) WITH ORDINALITY AS t(item, position)
$$ LANGUAGE SQL;

CREATE FUNCTION pg_temp.content_with_ids(content JSONB) RETURNS JSONB AS $$
  SELECT content || jsonb_build_object(
    'experience', pg_temp.with_ids(content->'experience', 'exp'),
    'projects', pg_temp.with_ids(content->'projects', 'proj'),
    'skills', pg_temp.with_ids(content->'skills', 'skill'),
    'education', pg_temp.with_ids(content->'education', 'edu'),
    'publications', pg_temp.with_ids(content->'publications', 'pub'),
    'awards', pg_temp.with_ids(content->'awards', 'awd'),
    'certifications', pg_temp.with_ids(content->'certifications', 'cert'),
    'sections', (
      SELECT COALESCE(
        jsonb_agg(
          section || jsonb_build_object('entries', pg_temp.with_ids(section->'entries', 'ent'))
          ORDER BY position
        ),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(pg_temp.with_ids(content->'sections', 'sec'))
        WITH ORDINALITY AS t(section, position)
    )
  )
$$ LANGUAGE SQL;

UPDATE "resumes" SET "content" = pg_temp.content_with_ids("content")
WHERE jsonb_typeof("content") = 'object';

UPDATE "resume_variants" SET "content" = pg_temp.content_with_ids("content")
WHERE jsonb_typeof("content") = 'object';
