"use client";

import {
  extractCategoricalFields,
  type CategoricalDisagreement,
} from "@/lib/categoricalFields";

type Props = {
  title: string;
  gradingData: unknown;
  disagreePaths: Set<string>;
};

export function PriorCategoricalColumn({
  title,
  gradingData,
  disagreePaths,
}: Props) {
  const fields = extractCategoricalFields(gradingData);

  return (
    <div className="section-block" style={{ minWidth: 0 }}>
      <h3 className="section-title" style={{ fontSize: 15, marginBottom: 10 }}>
        {title}
      </h3>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        仅显示选择题答案（不含手填与 Level 4）
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
        {fields.map((f) => {
          const hot = disagreePaths.has(f.path);
          return (
            <li
              key={f.path}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.4,
                background: hot ? "#fce7f3" : "transparent",
                border: hot ? "1px solid #f9a8d4" : "1px solid transparent",
              }}
            >
              <div style={{ color: "var(--muted)", marginBottom: 2 }}>{f.label}</div>
              <div style={{ fontWeight: 700 }}>{f.value ?? "—"}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function disagreePathSet(items: CategoricalDisagreement[]) {
  return new Set(items.map((d) => d.path));
}
