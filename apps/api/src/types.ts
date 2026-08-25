export interface ImageRow {
  id: string;
  s3_key: string;
  s3_url: string;
  original_prompt: string | null;
  enhanced_prompt: string | null;
  tags: string[] | null;
  style: string | null;
  subject: string | null;
  mood: string | null;
  color_palette: string[] | null;
  use_case: string | null;
  filename: string | null;
  created_at: string;
}

export interface ImageListQuery {
  page?: string;
  limit?: string;
  style?: string;
  mood?: string;
  use_case?: string;
}
