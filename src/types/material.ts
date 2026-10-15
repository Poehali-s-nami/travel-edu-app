export type MaterialType = "video" | "file";
export type ContentTab = "webinars" | "knowledge" | "tracks";
export type TrendingStamp = "Must read" | "Полезно знать" | "Горячий выпуск";

export type ContentAudience = {
  mode: "everyone" | "restricted";
  roles: Array<"HEAD" | "MANAGER" | "EMPLOYEE" | "PARTNER">;
  groupIds: string[];
};

export type Material = {
  id: string;
  title: string;
  description: string;
  type: MaterialType;
  url: string;
  coverUrl?: string;
  category: string[];
  tags?: string[];
  format: string;
  author: {
    name: string;
    company?: string;
  };
  duration: number;
  createdAt: Date;
  tab: Exclude<ContentTab, "tracks">;
  archived?: boolean;
  hiddenFromLibrary?: boolean;
  trendingStamp?: TrendingStamp | null;
  views?: number;
  testUrl?: string;
  audience?: ContentAudience;
};

export type TrackInfoBlock = {
  id: string;
  title: string;
  text: string;
  enabled: boolean;
  afterMaterialId: string;
};

export type LearningTrack = {
  id: string;
  title: string;
  description: string;
  materialIds: string[];
  infoBlocks?: TrackInfoBlock[];
  tags?: string[];
  coverUrl?: string;
  createdAt: Date;
  archived?: boolean;
  testUrl?: string;
  audience?: ContentAudience;
};

export type FilterState = {
  topics: string[];
  speakers: string[];
  formats: string[];
  durations: string[];
};
