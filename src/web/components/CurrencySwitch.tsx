import { useId } from "react";

/** EUR / USD: which currency a page shows (S1, S12). Hidden with only one. */
export function CurrencySwitch({
  currencies,
  value,
  onChange,
  className = "seg",
}: {
  currencies: string[];
  value: string;
  onChange: (currency: string) => void;
  className?: string;
}) {
  const id = useId();
  if (currencies.length < 2) return null;
  return (
    <div className={className} role="radiogroup" aria-label="Currency">
      {currencies.map((currency) => (
        <label key={currency}>
          <input
            type="radio"
            className="visually-hidden"
            name={`${id}-currency`}
            checked={currency === value}
            onChange={() => onChange(currency)}
          />
          {currency}
        </label>
      ))}
    </div>
  );
}
