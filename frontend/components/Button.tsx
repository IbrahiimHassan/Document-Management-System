import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "onDark";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  fullWidth?: boolean;
}

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover",
  secondary: "border border-line bg-surface text-ink hover:bg-brand-soft",
  danger: "bg-danger text-white hover:bg-danger/90",
  onDark: "border border-white/30 text-white hover:bg-white/10",
};

export function Button({
  variant = "primary",
  fullWidth = false,
  type = "button",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        fullWidth ? "w-full" : "w-fit"
      } ${variants[variant]} ${className}`}
    />
  );
}