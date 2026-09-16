// Fixed "en-US" grouping on both server and client so hydration never mismatches.

export function usd(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function dollarsFromCents(cents: number): string {
  return usd(cents / 100);
}

export function ngn(amount: number): string {
  return `₦${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
