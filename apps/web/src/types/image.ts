export interface Image {
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

export interface PaginatedImages {
  items: Image[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface FilterValue {
  value: string;
  count: number;
}

export interface FiltersResponse {
  styles: FilterValue[];
  moods: FilterValue[];
  useCases: FilterValue[];
}

export interface TagWithCount {
  tag: string;
  count: number;
}

export interface Stats {
  total: number;
  topStyles: FilterValue[];
  topMoods: FilterValue[];
  topTags: FilterValue[];
}

export interface ActiveFilters {
  style?: string;
  mood?: string;
  use_case?: string;
}

/** Formats accepted by GET /api/images/:id/download (see apps/api/src/routes/images.ts). */
export type DownloadFormat = 'webp' | 'png' | 'jpg';
