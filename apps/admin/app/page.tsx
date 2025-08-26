'use client';

import { useEffect, useState } from "react";

type Stats = {
  todayCalls: number;
  avgDuration: number;
  crisisPct: number;
  kbUsedPct: number;
};

export default function Page() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    // Placeholder: you would fetch from orchestrator /metrics
    setStats({
      todayCalls: 12,
      avgDuration: 482,
      crisisPct: 8.3,
      kbUsedPct: 14.1
    });
  }, []);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <Card title="Calls (Today)" value={stats?.todayCalls ?? 0} />
        <Card title="Avg Duration (s)" value={stats?.avgDuration ?? 0} />
        <Card title="Crisis %" value={stats?.crisisPct ?? 0} />
        <Card title="KB Used %" value={stats?.kbUsedPct ?? 0} />
      </div>
      <p style={{ marginTop: 24, color: "#888" }}>
        Connect this UI to your orchestrator's /metrics endpoint.
      </p>
    </div>
  );
}

function Card({ title, value }: { title: string; value: number }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 12, color: "#666" }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
