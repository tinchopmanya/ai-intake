import type { ButtonHTMLAttributes } from "react";
import type { HTMLAttributes } from "react";
import type { InputHTMLAttributes } from "react";
import type { SelectHTMLAttributes } from "react";
import type { TextareaHTMLAttributes } from "react";

type PanelProps = HTMLAttributes<HTMLDivElement>;
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};
type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
type InputProps = InputHTMLAttributes<HTMLInputElement>;
type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Panel({ className = "", ...props }: PanelProps) {
  return (
    <div
      className={`rounded-2xl border border-gray-200 bg-gray-100/80 p-4 shadow-sm ${className}`.trim()}
      {...props}
    />
  );
}

export function Button({ variant = "secondary", className = "", ...props }: ButtonProps) {
  const base =
    "rounded-xl px-4 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-gray-400/30 disabled:cursor-not-allowed disabled:opacity-60";
  const byVariant = {
    primary: "bg-gray-800 text-white hover:bg-gray-900",
    secondary: "border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-200/70",
  };
  return <button className={`${base} ${byVariant[variant]} ${className}`.trim()} {...props} />;
}

export function TextareaField({ className = "", ...props }: TextareaProps) {
  return (
    <textarea
      className={`w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-500 transition focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/25 disabled:bg-gray-100 disabled:text-gray-500 ${className}`.trim()}
      {...props}
    />
  );
}

export function InputField({ className = "", ...props }: InputProps) {
  return (
    <input
      className={`w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-500 transition focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/25 disabled:bg-gray-100 disabled:text-gray-500 ${className}`.trim()}
      {...props}
    />
  );
}

export function SelectField({ className = "", ...props }: SelectProps) {
  return (
    <select
      className={`w-full max-w-xs rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800 transition focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/25 disabled:bg-gray-100 disabled:text-gray-500 ${className}`.trim()}
      {...props}
    />
  );
}
