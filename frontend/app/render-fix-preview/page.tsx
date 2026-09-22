"use client";

import VisualDesignStudio from "@/components/VisualDesignStudio";
import type { PresentationData } from "@/types/presentation";

const sample = {
  id: "render-fix-check",
  title: "Earth's Water Systems",
  theme: "academic-clean",
  slides: [
    {
      id: "opener",
      slideNumber: 1,
      layout: "hero",
      title: "Earth's Water Systems",
      subtitle: "Storage, circulation, and access",
      imagePrompt: "Earth from space with visible oceans and atmosphere",
      content: {},
    },
    {
      id: "freshwater",
      slideNumber: 3,
      layout: "editorial",
      title: "Where is the Freshwater?",
      sectionLabel: "Freshwater reservoirs",
      content: {
        bodyText: "Freshwater is not readily available for consumption because much of it is locked away in ice or deep underground.",
        bullets: [
          "Ice caps and glaciers hold the largest reservoir of freshwater.",
          "Groundwater provides the primary source for drinking and agriculture.",
          "Only a small share is readily accessible in lakes and rivers.",
        ],
      },
    },
    {
      id: "vault",
      slideNumber: 5,
      layout: "image-feature",
      title: "The Frozen Vault",
      sectionLabel: "Glacial storage",
      imagePrompt: "Antarctic polar ice sheet and glacier landscape, documentary aerial photography",
      content: {
        bodyText: "Most freshwater is found in the polar ice sheets of Antarctica and Greenland. These reservoirs are critical for regulating global sea levels and reflecting solar radiation.",
        bullets: [
          "Contains nearly 70% of global freshwater reserves.",
          "Seasonal melt contributes to rivers and coastal systems.",
          "Long-term ice loss raises global sea levels.",
        ],
      },
    },
  ],
} as unknown as PresentationData;

export default function RenderFixPreview() {
  return <main className="h-screen w-screen"><VisualDesignStudio data={sample} initialSlide={1} /></main>;
}
