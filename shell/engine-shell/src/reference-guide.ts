import guideJson from '../../../docs/reference/ENGINE-REFERENCE-GUIDE.json';

export const engineOperationsSpecPath = 'docs/specs/ENGINE-OPERATIONS-SPEC.md';
export const engineSpatialAuthoringSpecPath = 'docs/specs/ENGINE-SPATIAL-AUTHORING-SPEC.md';

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
