export type SlideTheme = "cosmic-dark" | "neon-glass" | "executive-slate" | "academic-clean" | "sunset-gold";

export type ArtifactFormat =
  | "presentation"
  | "poster"
  | "academic-poster"
  | "infographic"
  | "report"
  | "research-summary"
  | "one-page-brief"
  | "study-sheet"
  | "handout"
  | "flyer"
  | "brochure"
  | "visual-roadmap";

export type DesignStyle =
  | "editorial"
  | "academic"
  | "scientific"
  | "minimal"
  | "modern"
  | "corporate"
  | "luxury"
  | "futuristic"
  | "playful"
  | "youthful"
  | "documentary"
  | "historical"
  | "cinematic"
  | "brutalist"
  | "magazine"
  | "museum"
  | "technology"
  | "data-focused"
  | "infographic-heavy"
  | "educational"
  | "creative"
  | "premium"
  | "bold-typography"
  | "research-poster"
  | "conference-poster";

export type VisualRole =
  | "none"
  | "hero-image"
  | "documentary-image"
  | "product-image"
  | "annotated-image"
  | "diagram"
  | "chart"
  | "map"
  | "timeline"
  | "typography";

export type DesignPalette = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  secondary: string;
  accent: string;
};

export type DesignPlan = {
  subject: string;
  audience: string;
  purpose: string;
  tone: string;
  keyMessage: string;
  readingDirection: "left-to-right" | "top-to-bottom" | "radial";
  style: DesignStyle;
  density: "spacious" | "balanced" | "dense";
  imageStrategy: string;
  recurringMotif: string;
  palette: DesignPalette;
};

export type SlideLayout = 
  | "hero" 
  | "poster"
  | "raster-poster"
  | "split" 
  | "metrics-3" 
  | "timeline" 
  | "comparison" 
  | "code"
  | "quote"
  | "bullets"
  | "fast-facts"
  | "characters"
  | "image-feature"
  | "section-header"
  | "stats-grid"
  | "closing"
  | "editorial"
  | "asymmetric"
  | "full-bleed"
  | "big-stat"
  | "process"
  | "cycle"
  | "matrix"
  | "quadrant"
  | "hierarchy"
  | "diagram"
  | "map"
  | "gallery"
  | "annotated-image"
  | "research-findings"
  | "references";

export type SlideMetric = {
  label: string;
  value: string;
  change?: string;
};

export type TimelineItem = {
  step: string;
  title: string;
  description: string;
};

export type ComparisonColumn = {
  title: string;
  points: string[];
};

export type FactCard = {
  icon: string;
  label: string;
  value: string;
};

export type CharacterCard = {
  name: string;
  description: string;
  imagePrompt?: string;
  role?: string;
};

export type SlideContent = {
  bullets?: string[];
  metrics?: SlideMetric[];
  timeline?: TimelineItem[];
  comparison?: {
    left: ComparisonColumn;
    right: ComparisonColumn;
  };
  codeSnippet?: {
    language: string;
    code: string;
  };
  quote?: {
    text: string;
    author: string;
  };
  imageKeywords?: string[];
  factCards?: FactCard[];
  characterCards?: CharacterCard[];
  bodyText?: string;
  kicker?: string;
  takeaway?: string;
  sources?: string[];
  chart?: {
    type: "bar" | "line" | "donut" | "area";
    data: Array<{ label: string; value: number; secondaryValue?: number }>;
    unit?: string;
  };
  process?: Array<{ title: string; description?: string }>;
  matrix?: {
    xLabel: string;
    yLabel: string;
    items: Array<{ label: string; x: number; y: number }>;
  };
};

export type SlideElementKind = "title" | "subtitle" | "body" | "bullet" | "image" | "shape" | "label";

export type SlideElementStyle = {
  kind: SlideElementKind;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  textAlign?: "left" | "center" | "right";
  offsetX?: number;
  offsetY?: number;
  scale?: number;
  objectPosition?: string;
  locked?: boolean;
};

export type Slide = {
  id: string;
  slideNumber: number;
  layout: SlideLayout;
  title: string;
  subtitle?: string;
  sectionLabel?: string;
  content: SlideContent;
  speakerNotes?: string;
  imageUrl?: string;
  imagePrompt?: string;
  /** Safe focal point used by cover-crop rendering and retained per slide. */
  imagePosition?: "left top" | "center top" | "right top" | "left center" | "center" | "right center" | "left bottom" | "center bottom" | "right bottom";
  accentColor?: string;
  iconEmoji?: string;
  visualRole?: VisualRole;
  visualCaption?: string;
  layoutVariant?: number;
  /** Stable, per-element overrides used by the non-destructive canvas editor. */
  elementStyles?: Record<string, SlideElementStyle>;
};

export type PresentationData = {
  id: string;
  title: string;
  subtitle?: string;
  theme: SlideTheme;
  author?: string;
  date?: string;
  hideImages?: boolean;
  format?: ArtifactFormat;
  designPlan?: DesignPlan;
  version?: 2;
  /** Canvas ratio for a generated poster that must open pixel-for-pixel in the editor. */
  canvasAspectRatio?: "2:3" | "3:2" | "1:1" | "4:5";
  slides: Slide[];
};
