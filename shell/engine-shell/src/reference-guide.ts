import guideJson from '../../../docs/reference/ENGINE-REFERENCE-GUIDE.json';

export interface ReferenceGuideSection {
  title: string;
  items: string[];
  note?: string;
  keywords?: string[];
}

export interface ReferenceGuidePage {
  id: string;
  title: string;
  summary: string;
  sections: ReferenceGuideSection[];
  keywords?: string[];
  references?: string[];
}

export interface ReferenceGuideCategory {
  id: string;
  title: string;
  description: string;
  pages: ReferenceGuidePage[];
  keywords?: string[];
}

export interface ReferenceGuide {
  title: string;
  intro: string;
  searchableSources: string[];
  assistantEntryPoints: string[];
  categories: ReferenceGuideCategory[];
}

export const engineReferenceGuide: ReferenceGuide = guideJson;
