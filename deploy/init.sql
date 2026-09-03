CREATE TABLE IF NOT EXISTS generated_images (
  id text PRIMARY KEY,
  s3_key text NOT NULL,
  s3_url text NOT NULL,
  original_prompt text,
  enhanced_prompt text,
  tags text[],
  style text,
  subject text,
  mood text,
  color_palette text[],
  use_case text,
  filename text,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generated_images_style ON generated_images(style);
CREATE INDEX IF NOT EXISTS idx_generated_images_mood ON generated_images(mood);
CREATE INDEX IF NOT EXISTS idx_generated_images_use_case ON generated_images(use_case);
CREATE INDEX IF NOT EXISTS idx_generated_images_created_at ON generated_images(created_at DESC);
