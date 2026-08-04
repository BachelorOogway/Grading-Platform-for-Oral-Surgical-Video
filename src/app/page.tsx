export default function HomePage() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Surgical Report Grading</h1>
      <p style={{ marginTop: 12, maxWidth: 720, lineHeight: 1.6 }}>
        该系统用于口腔/颌面外科专家对 AI 生成的手术报告进行结构化人工评分。请先进入
        登录页。
      </p>
      <a href="/login" style={{ display: "inline-block", marginTop: 16 }}>
        去登录
      </a>
    </main>
  );
}

