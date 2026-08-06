"use client";

type Props = {
  label: string;
  values: string[];
  disabled?: boolean;
  error?: boolean;
  countLabel?: string;
  onChange: (next: string[]) => void;
};

/** Dynamic list of text boxes with + to add more; count = non-empty entries. */
export function MissedItemsField({
  label,
  values,
  disabled,
  error,
  countLabel = "Count",
  onChange,
}: Props) {
  const list = values.length > 0 ? values : [""];
  const filled = list.map((s) => s.trim()).filter(Boolean).length;

  function updateAt(i: number, text: string) {
    const next = [...list];
    next[i] = text;
    onChange(next);
  }

  function addRow() {
    onChange([...list, ""]);
  }

  function removeAt(i: number) {
    if (list.length <= 1) {
      onChange([""]);
      return;
    }
    onChange(list.filter((_, idx) => idx !== i));
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
      {list.map((v, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            value={v}
            disabled={disabled}
            placeholder={`Missed item ${i + 1}`}
            onChange={(e) => updateAt(i, e.target.value)}
            style={{
              flex: 1,
              padding: 10,
              border: error ? "1px solid var(--danger-line)" : undefined,
            }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled || list.length <= 1}
            onClick={() => removeAt(i)}
            aria-label="Remove"
            title="Remove"
          >
            −
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={disabled}
          onClick={addRow}
          aria-label="Add"
        >
          + Add
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          {countLabel}: <strong style={{ color: "var(--ink)" }}>{filled}</strong>
        </span>
      </div>
    </div>
  );
}
