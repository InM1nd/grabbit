export type Platform =
  | 'instagram' | 'tiktok' | 'youtube' | 'x' | 'reddit' | 'telegram'
  | 'threads' | 'facebook' | 'linkedin' | 'pinterest' | 'vk' | 'github' | 'web';

export interface Metadata {
  url: string;          // canonical / resolved url
  platform: Platform;
  title?: string;
  description?: string;
  author?: string;
  image?: string;
  siteName?: string;
  blocked?: boolean;    // true when the site did not return usable metadata
  source: string;       // which strategy produced it (debug)
}

export interface AiResult {
  summary: string;
  tags: string[];
  board: string;
  boardEmoji?: string;
  title?: string;
  model: string;
}
