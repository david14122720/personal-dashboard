"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { t } from "@/lib/i18n";
import {
  createTransaction,
  createTransfer,
  useFinanceCategories,
} from "@/lib/api/finance";
import { useAccounts } from "@/lib/api/dashboard";
import {
  normalizeManualAmount,
  toAccountOptions,
  toCategoryOptions,
} from "@/lib/finance/finance";

/**
 * S1 manual capture in COP, no visible UUIDs. Amounts are typed by hand;
 * accounts/categories/payment methods are chosen by name in simple selectors.
 * Money stays a wire string until the API; coercion happens only in
 * `lib/finance/finance.ts` for reads.
 */

const inputClass =
  "w-full rounded-md border border-hull bg-deck px-3 py-2 text-sm text-instrument placeholder:text-instrument/40 focus:border-signal focus:outline-none";

const PAYMENT_OPTIONS = [
  { value: "", labelKey: "finance.selectPaymentMethod" },
  { value: "efectivo", labelKey: "finance.paymentCash" },
  { value: "débito", labelKey: "finance.paymentDebit" },
  { value: "transferencia", labelKey: "finance.paymentTransfer" },
  { value: "tarjeta", labelKey: "finance.paymentCard" },
  { value: "otro", labelKey: "finance.paymentOther" },
] as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function revalidateFinance(mutate: ReturnType<typeof useSWRConfig>["mutate"]): void {
  void mutate(
    (key) =>
      typeof key === "string" &&
      (key.startsWith("finance/") || key.startsWith("dashboard/")),
  );
}

function AccountSelect({
  label,
  value,
  onChange,
  accounts,
  loading,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  accounts: { id: string; name: string }[];
  loading: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-instrument/60">
      {label}
      <select
        aria-label={label}
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{loading ? t("common.loading") : t("finance.selectAccount")}</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function CategorySelect({
  value,
  onChange,
  categories,
  loading,
}: {
  value: string;
  onChange: (next: string) => void;
  categories: { id: string; name: string }[];
  loading: boolean;
}) {
  const label = t("finance.category");
  return (
    <label className="flex flex-col gap-1 text-xs text-instrument/60">
      {label}
      <select
        aria-label={label}
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{loading ? t("common.loading") : t("finance.selectCategory")}</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function useCaptureOptions() {
  const accountsQuery = useAccounts();
  const categoriesQuery = useFinanceCategories();
  const accounts = toAccountOptions(
    (accountsQuery.data ?? []).map((row) => ({ id: row.id, name: row.name })),
  );
  const categories = toCategoryOptions(categoriesQuery.data ?? []);
  return { accountsQuery, categoriesQuery, accounts, categories };
}

export function IncomeForm() {
  const { mutate } = useSWRConfig();
  const { accounts, categories, accountsQuery, categoriesQuery } = useCaptureOptions();
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const wireAmount = normalizeManualAmount(amount);
    if (!wireAmount || !occurredOn || !accountId) {
      setError(
        !wireAmount ? t("finance.amountPositiveError") : t("finance.requiredFieldError"),
      );
      return;
    }
    setPending(true);
    try {
      await createTransaction({
        account_id: accountId,
        type: "income",
        amount: wireAmount,
        occurred_on: occurredOn,
        ...(categoryId ? { category_id: categoryId } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setSaved(true);
      setAmount("");
      setDescription("");
      revalidateFinance(mutate);
    } catch {
      setError(t("finance.captureFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-label={t("finance.newIncome")}
      className="grid grid-cols-2 gap-3"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.amountCop")}
        <input
          aria-label={t("finance.amountCop")}
          inputMode="decimal"
          placeholder={t("finance.amountPlaceholder")}
          className={inputClass}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.dateLabel")}
        <input
          aria-label={t("finance.dateLabel")}
          type="date"
          className={inputClass}
          value={occurredOn}
          onChange={(event) => setOccurredOn(event.target.value)}
        />
      </label>
      <AccountSelect
        label={t("finance.account")}
        value={accountId}
        onChange={setAccountId}
        accounts={accounts}
        loading={accountsQuery.isLoading}
      />
      <CategorySelect
        value={categoryId}
        onChange={setCategoryId}
        categories={categories}
        loading={categoriesQuery.isLoading}
      />
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.descriptionOptional")}
        <input
          aria-label={t("finance.description")}
          placeholder={t("finance.descriptionPlaceholder")}
          className={inputClass}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50"
        >
          {pending ? t("finance.saving") : t("finance.saveIncome")}
        </button>
        {error ? (
          <p role="alert" className="text-xs text-alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-xs text-flow">
            {t("finance.captureSaved")}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function ExpenseForm() {
  const { mutate } = useSWRConfig();
  const { accounts, categories, accountsQuery, categoriesQuery } = useCaptureOptions();
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const wireAmount = normalizeManualAmount(amount);
    if (!wireAmount || !occurredOn || !accountId) {
      setError(
        !wireAmount ? t("finance.amountPositiveError") : t("finance.requiredFieldError"),
      );
      return;
    }
    setPending(true);
    try {
      await createTransaction({
        account_id: accountId,
        type: "expense",
        amount: wireAmount,
        occurred_on: occurredOn,
        ...(categoryId ? { category_id: categoryId } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(paymentMethod ? { payment_method: paymentMethod } : {}),
      });
      setSaved(true);
      setAmount("");
      setDescription("");
      revalidateFinance(mutate);
    } catch {
      setError(t("finance.captureFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-label={t("finance.newExpense")}
      className="grid grid-cols-2 gap-3"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.amountCop")}
        <input
          aria-label={t("finance.amountCop")}
          inputMode="decimal"
          placeholder={t("finance.amountPlaceholder")}
          className={inputClass}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.dateLabel")}
        <input
          aria-label={t("finance.dateLabel")}
          type="date"
          className={inputClass}
          value={occurredOn}
          onChange={(event) => setOccurredOn(event.target.value)}
        />
      </label>
      <AccountSelect
        label={t("finance.account")}
        value={accountId}
        onChange={setAccountId}
        accounts={accounts}
        loading={accountsQuery.isLoading}
      />
      <CategorySelect
        value={categoryId}
        onChange={setCategoryId}
        categories={categories}
        loading={categoriesQuery.isLoading}
      />
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.paymentMethod")}
        <select
          aria-label={t("finance.paymentMethod")}
          className={inputClass}
          value={paymentMethod}
          onChange={(event) => setPaymentMethod(event.target.value)}
        >
          {PAYMENT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.descriptionOptional")}
        <input
          aria-label={t("finance.description")}
          placeholder={t("finance.descriptionPlaceholder")}
          className={inputClass}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50"
        >
          {pending ? t("finance.saving") : t("finance.saveExpense")}
        </button>
        {error ? (
          <p role="alert" className="text-xs text-alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-xs text-flow">
            {t("finance.captureSaved")}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function TransferForm() {
  const { mutate } = useSWRConfig();
  const accountsQuery = useAccounts();
  const accounts = toAccountOptions(
    (accountsQuery.data ?? []).map((row) => ({ id: row.id, name: row.name })),
  );
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const wireAmount = normalizeManualAmount(amount);
    if (!wireAmount || !occurredOn || !fromId || !toId) {
      setError(
        !wireAmount ? t("finance.amountPositiveError") : t("finance.requiredFieldError"),
      );
      return;
    }
    if (fromId === toId) {
      setError(t("finance.sameAccountError"));
      return;
    }
    setPending(true);
    try {
      await createTransfer({
        from_account_id: fromId,
        to_account_id: toId,
        amount: wireAmount,
        occurred_on: occurredOn,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setSaved(true);
      setAmount("");
      setDescription("");
      revalidateFinance(mutate);
    } catch {
      setError(t("finance.captureFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-label={t("finance.newTransfer")}
      className="grid grid-cols-2 gap-3"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <AccountSelect
        label={t("finance.fromAccount")}
        value={fromId}
        onChange={setFromId}
        accounts={accounts}
        loading={accountsQuery.isLoading}
      />
      <AccountSelect
        label={t("finance.toAccount")}
        value={toId}
        onChange={setToId}
        accounts={accounts}
        loading={accountsQuery.isLoading}
      />
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.amountCop")}
        <input
          aria-label={t("finance.amountCop")}
          inputMode="decimal"
          placeholder={t("finance.amountPlaceholder")}
          className={inputClass}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.dateLabel")}
        <input
          aria-label={t("finance.dateLabel")}
          type="date"
          className={inputClass}
          value={occurredOn}
          onChange={(event) => setOccurredOn(event.target.value)}
        />
      </label>
      <label className="col-span-2 flex flex-col gap-1 text-xs text-instrument/60">
        {t("finance.descriptionOptional")}
        <input
          aria-label={t("finance.description")}
          placeholder={t("finance.descriptionPlaceholder")}
          className={inputClass}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-hull px-4 py-2 font-display text-sm transition-colors hover:border-signal hover:text-signal disabled:opacity-50"
        >
          {pending ? t("finance.saving") : t("finance.saveTransfer")}
        </button>
        {error ? (
          <p role="alert" className="text-xs text-alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-xs text-flow">
            {t("finance.transferSaved")}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function ManualCaptureSection() {
  return (
    <section
      aria-label={t("finance.captureRegion")}
      className="rounded-xl border border-hull bg-hull/40 p-5"
    >
      <h2 className="font-display text-base font-semibold tracking-wide">
        {t("finance.captureTitle")}
      </h2>
      <p className="mt-1 text-sm text-instrument/60">{t("finance.captureSubtitle")}</p>
      <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div>
          <h3 className="mb-3 font-display text-sm font-medium">{t("finance.newIncome")}</h3>
          <IncomeForm />
        </div>
        <div>
          <h3 className="mb-3 font-display text-sm font-medium">{t("finance.newExpense")}</h3>
          <ExpenseForm />
        </div>
        <div>
          <h3 className="mb-3 font-display text-sm font-medium">{t("finance.newTransfer")}</h3>
          <TransferForm />
        </div>
      </div>
    </section>
  );
}
