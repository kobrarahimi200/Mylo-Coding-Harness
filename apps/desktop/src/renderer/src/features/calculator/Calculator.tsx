import { useState } from "react";

// Completes the Calculator navigation already present in the working tree.
export function Calculator({ active }: { active: boolean }) {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [operator, setOperator] = useState("+");
  const a = Number(left),
    b = Number(right);
  const result =
    operator === "+" ? a + b : operator === "-" ? a - b : operator === "*" ? a * b : a / b;
  return (
    <section aria-label="Calculator" className="flex flex-1 flex-col gap-4 p-8">
      <h1 className="text-xl">Calculator</h1>
      <input
        aria-label="First number"
        type="number"
        value={left}
        onChange={(event) => setLeft(event.target.value)}
      />
      <select
        aria-label="Operation"
        value={operator}
        onChange={(event) => setOperator(event.target.value)}
      >
        {["+", "-", "*", "/"].map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
      <input
        aria-label="Second number"
        type="number"
        value={right}
        onChange={(event) => setRight(event.target.value)}
      />
      <output aria-live={active ? "polite" : "off"}>
        {left && right ? (Number.isFinite(result) ? result : "Undefined") : "Enter two numbers"}
      </output>
    </section>
  );
}
