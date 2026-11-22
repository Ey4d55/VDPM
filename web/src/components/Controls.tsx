import { useEffect, useId, useState, type ReactNode } from "react";
import { rich, richNode } from "./Sym";

/**
 * Numeric input with optional slider. Keeps a local text buffer so users can
 * type freely; commits only finite numbers inside [min, max].
 */
export function NumberField(props: {
  label: ReactNode;
  symbol?: string;
  unit?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  slider?: { min: number; max: number; step?: number };
  hint?: ReactNode;
  digits?: number;
  inputWidth?: number;
}) {
  const id = useId();
  const [text, setText] = useState(String(props.value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (Number(text) !== props.value) setText(String(+props.value.toFixed(props.digits ?? 6)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);
  const commit = (raw: string) => {
    setText(raw);
    const v = Number(raw);
    const ok = raw.trim() !== "" && Number.isFinite(v) && (props.min === undefined || v >= props.min) && (props.max === undefined || v <= props.max);
    setInvalid(!ok);
    if (ok) props.onChange(v);
  };
  const s = props.slider;
  const fill = s ? `${(100 * (Math.min(Math.max(props.value, s.min), s.max) - s.min)) / (s.max - s.min)}%` : undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {props.label}
        {props.symbol && <span className="sym">{rich(props.symbol)}</span>}
      </label>
      <span className="field-input">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={text}
          step={props.step ?? "any"}
          min={props.min}
          max={props.max}
          aria-invalid={invalid}
          style={props.inputWidth ? { width: props.inputWidth } : undefined}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => {
            if (invalid) {
              setText(String(props.value));
              setInvalid(false);
            }
          }}
        />
        {props.unit !== undefined && <span className="unit">{props.unit}</span>}
      </span>
      {s && (
        <input
          type="range"
          aria-label={typeof props.label === "string" ? props.label : undefined}
          min={s.min}
          max={s.max}
          step={s.step ?? (s.max - s.min) / 200}
          value={Math.min(Math.max(props.value, s.min), s.max)}
          style={{ ["--fill" as string]: fill }}
          onChange={(e) => commit(e.target.value)}
        />
      )}
      {props.hint && <span className="field-hint">{richNode(props.hint)}</span>}
    </div>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  full?: boolean;
}) {
  return (
    <div className={`segmented ${props.full ? "full" : ""}`} role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === props.value} title={o.title} onClick={() => props.onChange(o.value)}>
          {richNode(o.label)}
        </button>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: ReactNode; colour: string; kind?: "line" | "dashed" | "box" }[] }) {
  return (
    <div className="legend">
      {items.map((it, i) => (
        <span className="legend-item" key={i}>
          {it.kind === "box" ? (
            <span className="legend-box" style={{ background: it.colour }} />
          ) : (
            <span className={`legend-line ${it.kind === "dashed" ? "dashed" : ""}`} style={{ borderColor: it.colour }} />
          )}
          {richNode(it.label)}
        </span>
      ))}
    </div>
  );
}
