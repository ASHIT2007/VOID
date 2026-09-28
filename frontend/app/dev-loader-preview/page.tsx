import { notFound } from "next/navigation";
import VoidImageSkeleton from "@/components/VoidImageSkeleton";
import DynamicLoader from "@/components/DynamicLoader";

export default function LoaderPreview() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <main style={{ minHeight: "100vh", background: "#171717", padding: "40px 20px", color: "#ddd" }}>
      <section style={{ maxWidth: 860, margin: "0 auto" }}>
        <h1 style={{ fontSize: 14, marginBottom: 24 }}>Live task labels</h1>
        <DynamicLoader prompt="Explain Shisui's jutsu" />
        <DynamicLoader statusLogs={[{ action: 'Searching the web', query: 'Shisui Uchiha Kotoamatsukami and Mangekyo Sharingan', kind: 'task' }]} />
        <DynamicLoader statusLogs={[{ action: 'Reading a source', query: 'naruto.fandom.com/wiki/Shisui_Uchiha', kind: 'task' }]} />
        <DynamicLoader statusLogs={[{ action: 'Running Python code', query: '', kind: 'task' }]} />
        <DynamicLoader stage="generating" />
        <div style={{ maxWidth: 320, marginBottom: 24 }}>
          <h2 style={{ fontSize: 14, marginBottom: 12 }}>Narrow chat column</h2>
          <DynamicLoader statusLogs={[{ action: 'Searching the web', query: 'Shisui Uchiha Kotoamatsukami and Mangekyo Sharingan', kind: 'task' }]} />
          <DynamicLoader statusLogs={[{ action: 'Reading a source', query: 'naruto.fandom.com/wiki/Shisui_Uchiha', kind: 'task' }]} />
        </div>
        <h1 style={{ fontSize: 14, marginBottom: 24 }}>Image generation</h1>
        <VoidImageSkeleton />
        <div style={{ width: "100%", maxWidth: 340, marginTop: 32 }}>
          <VoidImageSkeleton />
        </div>
      </section>
    </main>
  );
}
