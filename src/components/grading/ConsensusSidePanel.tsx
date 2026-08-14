"use client";

import type { CategoricalDisagreement } from "@/lib/categoricalFields";

type PriorGrader = {
  expertId: string;
  name: string;
  graderSlot: number;
  gradingData: unknown;
};

type Props = {
  disagreements: CategoricalDisagreement[];
  priorGraders: PriorGrader[];
  selectedForDiscrepancy: Set<string>;
  onToggleDiscrepancy: (path: string) => void;
  completed?: boolean;
};

export function ConsensusSidePanel({
  disagreements,
  priorGraders,
  selectedForDiscrepancy,
  onToggleDiscrepancy,
  completed,
}: Props) {
  const g1 = priorGraders.find((p) => p.graderSlot === 1);
  const g2 = priorGraders.find((p) => p.graderSlot === 2);

  return (
    <aside
      className="section-block"
      style={{
        position: "sticky",
        top: 12,
        maxHeight: "calc(100vh - 24px)",
        overflow: "auto",
      }}
    >
      <h2 className="section-title" style={{ fontSize: 16 }}>
        第 3 评分者 · 对照与分歧
      </h2>
      <p className="page-lead" style={{ fontSize: 13, marginBottom: 12 }}>
        前两位在<strong>选择题</strong>上的分歧已粉标。提交时：
        <strong>未勾选</strong>的项按三位答案多数决（2:1）写入最终答案；
        <strong>勾选 discrepancy solve</strong>的项不自动多数决，会显示在三位评分者的
        Dashboard 上供进一步处理。无投票。Level 4 与手填不参与对照。
      </p>

      <div style={{ display: "grid", gap: 8, marginBottom: 14, fontSize: 13 }}>
        <div>
          <strong>Grader 1</strong>:{" "}
          {g1 ? `${g1.expertId} (${g1.name})` : "— 未完成"}
        </div>
        <div>
          <strong>Grader 2</strong>:{" "}
          {g2 ? `${g2.expertId} (${g2.name})` : "— 未完成"}
        </div>
      </div>

      {disagreements.length === 0 ? (
        <div className="notice notice-ok">前两位在选择题上意见一致，无粉标项。</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
          {disagreements.map((d) => (
            <li
              key={d.path}
              id={`consensus-${d.path.replace(/\./g, "-")}`}
              style={{
                background: "#fce7f3",
                border: "1px solid #f9a8d4",
                borderRadius: 8,
                padding: 10,
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{d.label}</div>
              <div>
                G1: <strong>{d.grader1Value}</strong>
              </div>
              <div>
                G2: <strong>{d.grader2Value}</strong>
              </div>
              {!completed ? (
                <label
                  style={{
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    marginTop: 8,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedForDiscrepancy.has(d.path)}
                    onChange={() => onToggleDiscrepancy(d.path)}
                  />
                  discrepancy solve（不多数决）
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {!completed && selectedForDiscrepancy.size > 0 ? (
        <div className="notice notice-info" style={{ marginTop: 12, fontSize: 12 }}>
          已勾选 {selectedForDiscrepancy.size} 项 discrepancy solve，将在提交评分时一并登记。
        </div>
      ) : null}
    </aside>
  );
}

/** Map field path → CSS marker class for pink highlight in the form */
export function disagreementPathSet(disagreements: CategoricalDisagreement[]) {
  return new Set(disagreements.map((d) => d.path));
}
