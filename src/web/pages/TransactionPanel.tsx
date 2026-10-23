import { useEffect, useId, useRef, useState } from "react";
import type { Account } from "../../domain/accounts.ts";
import { formatDate, formatWhen } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import { suggestText } from "../../domain/rules.ts";
import {
  useAccounts,
  useCategories,
  useExclude,
  useRules,
  useSetCategory,
  useUnlink,
  type ListedTransaction,
  type TransferSide,
} from "../api.ts";
import { CategorySelect } from "../components/CategorySelect.tsx";
import { FormError } from "../components/Dialog.tsx";
import { describedBy, Field } from "../components/Field.tsx";
import { Icon } from "../components/Icon.tsx";
import { CategoryForm } from "../dialogs/CategoryForm.tsx";
import { LinkTransfer } from "../dialogs/LinkTransfer.tsx";
import { RuleForm } from "../dialogs/RuleForm.tsx";
import { possibleMatches, ruleName } from "../labels.ts";
import { useIsMobile } from "../useIsMobile.ts";

/**
 * S6: one transaction, to look at and fix. On desktop it's a side panel that
 * leaves the list usable, so I can go from row to row; on mobile it's full
 * screen.
 */
export function TransactionPanel({
  account,
  transaction: t,
  onClose,
}: {
  account: Account;
  transaction: ListedTransaction;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const categories = useCategories();
  const rules = useRules(t.ruleId !== null);
  const { data: accounts = [] } = useAccounts();
  const setCategory = useSetCategory();
  const exclude = useExclude();
  const unlink = useUnlink();
  // The dialog open over the panel: a new category, a rule from this, or
  // its transfer's other side.
  const [dialog, setDialog] = useState<"category" | "rule" | "link" | null>(
    null,
  );
  const readOnly = account.archivedOn !== null;

  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A dialog handles its own Escape.
      if (e.key === "Escape" && !dialog && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialog, onClose]);

  // The category just picked, until the list catches up.
  const picking =
    setCategory.isPending && setCategory.variables.id === t.id
      ? setCategory.variables.categoryId
      : undefined;
  const categoryId = picking === undefined ? t.categoryId : picking;
  // The rule that gave the category, until I pick another.
  const ruleId = picking === undefined ? t.ruleId : null;
  const rule = rules.data?.rules.find((r) => r.id === ruleId);
  const names = new Map(
    categories.data?.categories.map((c) => [c.id, c.name]) ?? [],
  );
  const hint = t.excluded
    ? "It's excluded, so it doesn't count in reports or budgets whatever its category."
    : rule
      ? `Given by the rule ${ruleName(rule, accounts)}.`
      : categoryId === null && t.conflict
        ? `Its rules disagree: ${t.conflict.map((c) => names.get(c)).join(" or ")}. Pick the category.`
        : undefined;

  const toPick = t.toPick;
  // Not linked yet: a possible transfer says how many could be its other
  // side; any other transaction can still be linked by hand.
  const unlinkedSection = (
    <section className="detail-section">
      <h3>
        <Icon name="transfer" className="icon icon-sm" />
        Transfer
      </h3>
      {toPick ? (
        <div className="banner tone-warning">
          <Icon name="alert" />
          <span className="text">
            <strong>Transfer to pick</strong>
            {possibleMatches(
              toPick.count,
              toPick.accountIds.map(
                (a) => accounts.find((x) => x.id === a)?.name ?? "",
              ),
            )}
            . Pick the other side to link them.
          </span>
        </div>
      ) : (
        <p className="muted">Not linked to another account.</p>
      )}
      {!readOnly && (
        <button
          type="button"
          className={toPick ? "btn btn-primary" : "btn btn-secondary"}
          onClick={() => setDialog("link")}
        >
          <Icon name="transfer" />
          Link transfer…
        </button>
      )}
    </section>
  );

  const close = (
    <button
      type="button"
      className={isMobile ? "icon-btn back" : "icon-btn"}
      aria-label="Close"
      onClick={onClose}
    >
      <Icon name={isMobile ? "back" : "x"} />
    </button>
  );

  return (
    <aside
      ref={ref}
      className="panel"
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
    >
      <header className="panel-head">
        {isMobile && close}
        <h2 id={`${id}-title`}>Transaction</h2>
        {!isMobile && close}
      </header>
      <div className="detail">
        <FormError
          error={
            setCategory.error ??
            exclude.error ??
            unlink.error ??
            categories.error
          }
        />
        <div className="detail-hero">
          <span className="title">{t.description}</span>
          <span
            className={
              t.transfer
                ? "big-number amount transfer"
                : t.amount > 0 && !t.excluded
                  ? "big-number amount income"
                  : "big-number amount"
            }
          >
            {formatAmount(t.amount, account.currency, { signed: true })}
          </span>
          {t.excluded && (
            <span className="tag tone-neutral">
              <Icon name="eye-off" />
              Excluded
            </span>
          )}
          {t.nearMatchOf !== null && !t.excluded && (
            <span className="caption">
              Kept although it looked like a duplicate
            </span>
          )}
        </div>
        <dl className="facts">
          <dt>Account</dt>
          <dd>{account.name}</dd>
          <dt>Date</dt>
          <dd>
            {formatDate(t.date)}
            {t.time && ` at ${t.time.slice(0, 5)}`}
          </dd>
          {t.reference && (
            <>
              <dt>Reference</dt>
              <dd>{t.reference}</dd>
            </>
          )}
        </dl>

        {t.transfer ? (
          <Transfer
            side={t.transfer}
            unlinking={unlink.isPending}
            onUnlink={readOnly ? undefined : () => unlink.mutate(t.id)}
          />
        ) : (
          <>
            {/* A possible transfer: that decision comes first. */}
            {t.toPick && unlinkedSection}
            <section className="detail-section">
              <Field id={`${id}-category`} label="Category" hint={hint}>
                <CategorySelect
                  id={`${id}-category`}
                  value={categoryId}
                  amount={t.amount}
                  none="Uncategorized"
                  disabled={readOnly}
                  onPick={(picked) =>
                    setCategory.mutate({ id: t.id, categoryId: picked })
                  }
                  onNew={() => setDialog("category")}
                  {...describedBy(`${id}-category`, undefined, hint)}
                />
              </Field>
              {!readOnly && categoryId !== null && ruleId === null && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setDialog("rule")}
                >
                  Create rule from this
                </button>
              )}
            </section>
            {!t.toPick && !t.excluded && unlinkedSection}
          </>
        )}

        {!readOnly && (
          <div className="detail-foot">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={exclude.isPending}
              onClick={() =>
                exclude.mutate({ id: t.id, excluded: !t.excluded })
              }
            >
              {t.excluded ? "Restore transaction" : "Exclude transaction"}
            </button>
          </div>
        )}
      </div>

      {dialog === "category" && (
        <CategoryForm
          type={t.amount > 0 ? "income" : "expense"}
          onClose={() => setDialog(null)}
          onSaved={(category) =>
            setCategory.mutate({ id: t.id, categoryId: category.id })
          }
        />
      )}
      {dialog === "rule" && (
        <RuleForm
          prefill={{ text: suggestText(t.description), categoryId }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "link" && (
        <LinkTransfer
          transaction={{
            ...t,
            accountId: account.id,
            currency: account.currency,
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </aside>
  );
}

/** S6's Transfer section for a linked transfer: its other side, and Unlink. */
function Transfer({
  side,
  unlinking,
  onUnlink,
}: {
  side: TransferSide;
  unlinking: boolean;
  /** Left out when the account is archived. */
  onUnlink?: () => void;
}) {
  const { data: accounts = [] } = useAccounts();
  const other = accounts.find((a) => a.id === side.accountId);
  return (
    <section className="detail-section">
      <h3>
        <Icon name="transfer" className="icon icon-sm" />
        Transfer
      </h3>
      <div className="linked">
        <Icon name="transfer" />
        <strong>Linked to {other?.name}</strong>
        <span className="caption">
          {side.description} · {formatWhen(side.date, side.time)}
        </span>
        {other && (
          <span className="amount transfer">
            {formatAmount(side.amount, other.currency, { signed: true })}
          </span>
        )}
      </div>
      {onUnlink && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={unlinking}
          onClick={onUnlink}
        >
          <Icon name="unlink" />
          Unlink
        </button>
      )}
      <p className="caption">
        Transfers don't count as income or expense, so they have no category.
      </p>
    </section>
  );
}
