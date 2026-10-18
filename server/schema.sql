CREATE TABLE IF NOT EXISTS ekko_remixes (
 id uuid PRIMARY KEY,
 edit_hash text NOT NULL,
 parent_id uuid REFERENCES ekko_remixes(id),
 parent_revision integer,
 revision integer NOT NULL DEFAULT 1,
 visibility text NOT NULL CHECK (visibility IN ('unlisted','public')),
 document jsonb NOT NULL,
 thumbnail text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ekko_remixes_public ON ekko_remixes(created_at DESC,id DESC) WHERE visibility='public';
CREATE TABLE IF NOT EXISTS ekko_remix_revisions (
 remix_id uuid NOT NULL REFERENCES ekko_remixes(id) ON DELETE CASCADE,
 revision integer NOT NULL,
 document jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (remix_id,revision)
);
CREATE TABLE IF NOT EXISTS ekko_remix_limits (
 bucket text NOT NULL,
 hour timestamptz NOT NULL,
 requests integer NOT NULL DEFAULT 1,
 PRIMARY KEY (bucket,hour)
);
