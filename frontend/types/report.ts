export type ReportSectionType = 
  | "hero_header"
  | "executive_summary"
  | "key_takeaways"
  | "metric_grid"
  | "data_table"
  | "callout"
  | "chart";

export type MetricItem = {
  label: string;
  value: string;
  trend?: string;
};

export type TableColumn = {
  key: string;
  header: string;
};

export type ChartDataPoint = {
  label: string;
  value: number;
  secondaryValue?: number;
};

export type ReportSection = {
  id: string;
  type: ReportSectionType;
  title?: string;
  subtitle?: string;
  content?: string;
  items?: string[];
  metrics?: MetricItem[];
  table?: {
    columns: TableColumn[];
    rows: Record<string, any>[];
  };
  callout?: {
    variant: "tip" | "warning" | "insight" | "important";
    text: string;
  };
  chart?: {
    chartType: "bar" | "line" | "pie";
    data: ChartDataPoint[];
  };
};

export type ReportData = {
  id: string;
  title: string;
  category: string;
  author: string;
  date: string;
  readTime: string;
  sections: ReportSection[];
};
