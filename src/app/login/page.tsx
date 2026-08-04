"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useState } from "react";

type LoginForm = {
  name: string;
  password: string;
};

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit, formState } = useForm<LoginForm>({
    defaultValues: { name: "", password: "" },
  });

  async function onSubmit(values: LoginForm) {
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "登录失败");
      return;
    }

    const expertId = data?.expertId as string | undefined;
    if (!expertId) {
      setError("登录返回缺少 expertId");
      return;
    }

    localStorage.setItem("expertId", expertId);
    router.push("/dashboard");
  }

  return (
    <main className="app-shell">
      <div className="app-shell-inner" style={{ maxWidth: 440 }}>
        <div className="login-card">
          <div className="brand-mark">Oral Surgical Grading</div>
          <h1 className="page-title">专家登录</h1>
          <p className="page-lead" style={{ marginBottom: 18 }}>
            欢迎回来。请使用姓名与密码进入任务面板，继续完成报告评分。
          </p>

          <form onSubmit={handleSubmit(onSubmit)}>
            <label>
              <span>姓名</span>
              <input {...register("name", { required: true })} placeholder="输入姓名" />
            </label>

            <label>
              <span>密码</span>
              <input
                {...register("password", { required: true })}
                type="password"
                placeholder="输入密码"
              />
            </label>

            {error ? <div className="notice notice-danger">{error}</div> : null}

            <button
              type="submit"
              disabled={!formState.isValid}
              className="btn btn-primary btn-block"
            >
              进入平台
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
