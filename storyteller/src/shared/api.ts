/**
 * The Community API's data shapes, shared by the server and the app.
 * Plain interfaces only: nothing here runs.
 */

export type Role = 'user' | 'moderator' | 'admin';

export interface UserSummary {
  username: string;
  displayName: string;
  color: string;
}

export interface Me extends UserSummary {
  id: number;
  bio: string;
  role: Role;
  createdAt: number;
  unreadNotifications: number;
}

/** A processed picture on the server: blob id, size and the widths it is served at. */
export interface MediaInfo {
  id: string;
  w: number;
  h: number;
  widths: number[];
}

/** Picture code (`img:<ref>`) to its server copy. */
export type MediaMap = Record<string, MediaInfo>;

export interface EpisodeRef {
  id: string;
  title: string;
  number: number;
}

export interface StoryCard {
  id: string;
  title: string;
  description: string;
  genre: string;
  tags: string[];
  author: UserSummary;
  cover: MediaInfo | null;
  episodes: number;
  followers: number;
  likes: number;
  lastPublishedAt: number | null;
  latest: EpisodeRef | null;
  hidden: boolean;
}

export interface EpisodeSummary extends EpisodeRef {
  cover: MediaInfo | null;
  publishedAt: number;
  updatedAt: number;
  words: number;
  likes: number;
  comments: number;
  hidden: boolean;
}

export interface ChapterInfo {
  id: string;
  title: string;
  position: number;
  cover: MediaInfo | null;
  episodes: EpisodeSummary[];
}

export interface StoryDetail extends StoryCard {
  chapters: ChapterInfo[];
  viewer: {
    following: boolean;
    followingAuthor: boolean;
    isAuthor: boolean;
    canModerate: boolean;
    /** The episode this reader got to, for "Continue reading". */
    progress: EpisodeRef | null;
  };
}

export interface EpisodeDetail extends EpisodeRef {
  body: string;
  revision: number;
  words: number;
  publishedAt: number;
  updatedAt: number;
  cover: MediaInfo | null;
  media: MediaMap;
  story: { id: string; title: string; genre: string; author: UserSummary; cover: MediaInfo | null };
  chapter: { id: string; title: string; position: number };
  prev: EpisodeRef | null;
  next: EpisodeRef | null;
  likes: number;
  comments: number;
  hidden: boolean;
  viewer: {
    liked: boolean;
    followingStory: boolean;
    followingAuthor: boolean;
    isAuthor: boolean;
    canModerate: boolean;
  };
}

export interface CommentDto {
  id: number;
  author: UserSummary | null;
  body: string;
  createdAt: number;
  editedAt: number | null;
  deleted: boolean;
  hidden: boolean;
  likes: number;
  viewer: { liked: boolean; canEdit: boolean; canDelete: boolean };
  replies: CommentDto[];
}

export interface AuthorProfile extends UserSummary {
  bio: string;
  createdAt: number;
  followers: number;
  following: number;
  stories: StoryCard[];
  viewer: { following: boolean; isSelf: boolean; canModerate: boolean };
  banned: boolean;
}

export type NotificationKind = 'episode' | 'comment' | 'reply' | 'like' | 'follow';

export interface NotificationDto {
  id: number;
  kind: NotificationKind;
  actor: UserSummary | null;
  story: { id: string; title: string } | null;
  episode: EpisodeRef | null;
  comment: { id: number; excerpt: string } | null;
  createdAt: number;
  read: boolean;
}

export type ReportReason = 'spam' | 'harassment' | 'hate' | 'sexual' | 'violence' | 'copyright' | 'other';

export interface ReportDto {
  id: number;
  targetKind: 'story' | 'episode' | 'comment' | 'user';
  targetId: string;
  /** A short description of what was reported, for the moderator. */
  targetLabel: string;
  /** Where to go to see it in the app. */
  targetLink: string | null;
  reason: ReportReason;
  details: string;
  reporter: UserSummary | null;
  createdAt: number;
  count: number;
}

export interface ModUser extends UserSummary {
  role: Role;
  banned: boolean;
  createdAt: number;
  stories: number;
  comments: number;
}

export interface ModLogEntry {
  id: number;
  moderator: UserSummary | null;
  action: string;
  targetKind: string;
  targetId: string;
  note: string;
  createdAt: number;
}

export interface MyStory {
  id: string;
  title: string;
  description: string;
  genre: string;
  tags: string[];
  coverRef: string | null;
  lastPublishedAt: number | null;
  chapters: { id: string; title: string; position: number; coverRef: string | null; episodes: EpisodeRef[] }[];
}

export interface Page<T> {
  items: T[];
  next: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    /** Picture codes the server does not have yet. */
    refs?: string[];
    /** The newer version, on a 409 conflict. */
    current?: { revision: number; body: string; updatedAt: number };
    /** Parser problems with the episode text. */
    issues?: { line: number; message: string }[];
  };
}

export interface Health {
  ok: true;
  version: string;
  registrationOpen: boolean;
}

export const GENRES = [
  'Drama',
  'Romance',
  'Comedy',
  'Mystery',
  'Thriller',
  'Horror',
  'Fantasy',
  'Sci-fi',
  'Adventure',
  'Slice of life',
  'Historical',
  'Fan fiction',
  'Other',
] as const;
