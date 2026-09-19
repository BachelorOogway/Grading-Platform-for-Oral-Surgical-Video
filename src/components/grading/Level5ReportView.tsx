"use client";

import {
  cleanLevel5Report,
  splitLevel5Report,
} from "@/lib/level5Dimensions";

/** HH:MM:SS, MM:SS, and ranges with to / dash, with or without brackets. */
const TS_RE =
  /\[?\s*\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?(?:\s*(?:to|-|–|—)\s*\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)?\s*\]?/g;

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatLine(line: string) {
  return escapeHtml(line).replace(TS_RE, (m) => `<mark class="l5-ts">${m}</mark>`);
}

export function Level5ReportView({ report }: { report: string }) {
  const cleaned = cleanLevel5Report(report);
  if (!cleaned) {
    return (
      <div className="notice notice-danger">
        未解析到 Level 5 手术报告。请在 AI 输出末尾加入 Level 5 Analysis 及报告正文后重新上传。
      </div>
    );
  }

  const sections = splitLevel5Report(cleaned);
  return (
    <div className="l5-report">
      {sections.map((s) => (
        <section key={s.key} className="l5-section">
          <div className="l5-section-title">{s.label}</div>
          {s.body.split(/\n/).map((line, i) => (
            <p
              key={i}
              style={{ margin: "0 0 6px" }}
              dangerouslySetInnerHTML={{ __html: formatLine(line) || "—" }}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
