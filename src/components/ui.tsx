import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { STATUS_LABELS, STATUS_TONE } from "../lib/selectors";
import { SLOT_LABELS } from "../lib/defaults";
import type { PatientStatus, SlotType } from "../types";

export { Icon } from "./Icon";
export type { IconName } from "./Icon";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "soft" | "danger" | "whatsapp";
type ButtonSize = "sm" | "md" | "lg";

export function Button({
  children,
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
}) {
  return (
    <button type={type} className={cx("btn", `btn--${variant}`, `btn--${size}`, className)} {...rest}>
      {icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} /> : null}
      <span>{children}</span>
      {iconRight ? <Icon name={iconRight} size={size === "sm" ? 16 : 18} /> : null}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  variant?: "ghost" | "soft" | "danger";
  size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx("icon-btn", `icon-btn--${variant}`, `icon-btn--${size}`, className)}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 17 : 19} />
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
  dot,
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "info" | "muted" | "clay";
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={cx("badge", `badge--${tone}`, className)}>
      {dot ? <span className="badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: PatientStatus }) {
  return (
    <Badge tone={STATUS_TONE[status] as "ok" | "warn" | "danger" | "muted"} dot>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function SlotBadge({ slot, className }: { slot: SlotType; className?: string }) {
  return <span className={cx("slot-badge", `slot-badge--${slot}`, className)}>{SLOT_LABELS[slot]}</span>;
}

const AVATAR_TONES = ["sage", "clay", "sky", "sand", "plum", "forest"];

export function Avatar({
  name,
  size = "md",
  tone,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  tone?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  const hash = Array.from(name).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const chosen = tone ?? AVATAR_TONES[hash % AVATAR_TONES.length];
  return (
    <span className={cx("avatar", `avatar--${size}`, `avatar--${chosen}`)} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

export function Card({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "aside";
}) {
  return <Tag className={cx("card", className)}>{children}</Tag>;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("section-heading", className)}>
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {description ? <p className="section-heading__description">{description}</p> : null}
      </div>
      {actions ? <div className="section-heading__actions">{actions}</div> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  icon = "sparkles",
  title,
  description,
  action,
  compact,
}: {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx("empty-state", compact && "empty-state--compact")}>
      <span className="empty-state__icon">
        <Icon name={icon} size={24} />
      </span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  htmlFor,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cx("field", error && "field--error", className)}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="field__required"> *</span> : null}
      </label>
      {children}
      {error ? <p className="field__error">{error}</p> : null}
      {!error && hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("input", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("textarea", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="select-wrap">
      <select className={cx("select", className)} {...rest}>
        {children}
      </select>
      <Icon name="chevronDown" size={16} />
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar…",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cx("search-input", className)}>
      <Icon name="search" size={18} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-label={placeholder}
      />
      {value ? (
        <button type="button" aria-label="Limpar busca" onClick={() => onChange("")} className="search-input__clear">
          <Icon name="x" size={15} />
        </button>
      ) : null}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cx("checkbox", disabled && "checkbox--disabled")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="checkbox__box" aria-hidden="true">
        <Icon name="check" size={13} />
      </span>
      <span className="checkbox__text">
        <span>{label}</span>
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: Array<{ value: T; label: string; icon?: IconName }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={cx("segmented", className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx("segmented__item", value === option.value && "is-active")}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.icon ? <Icon name={option.icon} size={15} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cx("tabs", className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={cx("tabs__item", value === tab.value && "is-active")}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="tabs__count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({
  value,
  max,
  tone = "sage",
  label,
}: {
  value: number;
  max: number;
  tone?: "sage" | "clay" | "sky" | "plum" | "sand";
  label?: string;
}) {
  const percent = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className={cx("progress", `progress--${tone}`)}>
      <div className="progress__track">
        <div className="progress__bar" style={{ width: `${percent}%` }} />
      </div>
      {label ? <span className="progress__label">{label}</span> : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus(), 40);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className={cx("modal", `modal--${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
      >
        <div className="modal__head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <IconButton icon="x" label="Fechar" onClick={onClose} />
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirmar",
  tone = "primary",
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            icon={tone === "danger" ? "alert" : "check"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<{ push: (message: string, tone?: ToastTone) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const push = useCallback((message: string, tone: ToastTone = "success") => {
    counter.current += 1;
    const id = counter.current;
    setItems((current) => [...current.slice(-2), { id, tone, message }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 4600);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={cx("toast", `toast--${item.tone}`)}>
            <Icon
              name={item.tone === "success" ? "checkCircle" : item.tone === "error" ? "alert" : "info"}
              size={19}
            />
            <span>{item.message}</span>
            <button
              type="button"
              aria-label="Fechar aviso"
              onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast precisa estar dentro de ToastProvider.");
  return context;
}

export function InfoNote({
  icon = "info",
  tone = "info",
  title,
  children,
}: {
  icon?: IconName;
  tone?: "info" | "warn" | "ok" | "clay";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("info-note", `info-note--${tone}`)}>
      <Icon name={icon} size={19} />
      <div>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
