import React from "react";
import type { PrototypeRecord } from "./types.js";
import { PRODUCTION_PHASE_REASON } from "./actions.js";

export function PrototypeLabel({
  children = "Prototype data",
}: {
  children?: React.ReactNode;
}) {
  return <span className="emis-prototype-label">{children}</span>;
}

export function ModuleHeader({
  title,
  description,
  prototype = true,
}: {
  title: string;
  description: string;
  prototype?: boolean;
}) {
  return (
    <header className="emis-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {prototype && <PrototypeLabel />}
    </header>
  );
}

export function SummaryCards({
  items,
}: {
  items: Array<{
    label: string;
    value: string | number;
    tone?: string;
    note?: string;
    onClick?: () => void;
  }>;
}) {
  return (
    <section className="emis-summary-grid" aria-label="Summary">
      <>
        {items.map((item) => {
          const content = (
            <>
              <span>{item.label}</span>
              <strong style={{ color: item.tone || "#f8fafc" }}>
                {item.value}
              </strong>
              {item.note && <small>{item.note}</small>}
            </>
          );
          return item.onClick ? (
            <button
              type="button"
              className="emis-card emis-summary-card emis-card-action"
              onClick={item.onClick}
              key={item.label}
              aria-label={`Open ${item.label}`}
            >
              {content}
            </button>
          ) : (
            <article className="emis-card emis-summary-card" key={item.label}>
              {content}
            </article>
          );
        })}
      </>
    </section>
  );
}

export function RecordTable({
  records,
  onSelect,
  emptyMessage = "No records are available.",
}: {
  records: PrototypeRecord[];
  onSelect?: (record: PrototypeRecord) => void;
  emptyMessage?: string;
}) {
  if (!records.length)
    return (
      <div className="emis-empty">
        <strong>No records</strong>
        <p>{emptyMessage}</p>
      </div>
    );
  return (
    <div className="emis-table-wrap">
      <table className="emis-table">
        <thead>
          <tr>
            <th>Reference</th>
            <th>Facility / source</th>
            <th>LGA</th>
            <th>Status</th>
            <th>Date</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              key={record.id}
              onClick={() => onSelect?.(record)}
              tabIndex={onSelect ? 0 : undefined}
              onKeyDown={(event) => {
                if (onSelect && (event.key === "Enter" || event.key === " "))
                  onSelect(record);
              }}
            >
              <td>
                <strong>{record.id}</strong>
              </td>
              <td>{record.facility}</td>
              <td>{record.lga}</td>
              <td>
                <span className="emis-status">{record.status}</span>
              </td>
              <td>{record.date}</td>
              <td>{record.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DetailPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside className="emis-detail" aria-label={title}>
      <div className="emis-detail-head">
        <h2>{title}</h2>
        <button onClick={onClose} aria-label="Close detail">
          Close
        </button>
      </div>
      {children}
    </aside>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="emis-filters" aria-label="Filters">
      {children}
    </div>
  );
}

export function DisabledPrototypeAction({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span className="emis-disabled-wrap">
      <button
        type="button"
        className="emis-action"
        disabled
        title={PRODUCTION_PHASE_REASON}
      >
        {children}
      </button>
      <small>{PRODUCTION_PHASE_REASON}</small>
    </span>
  );
}

export function PrototypeModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div
      className="emis-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="emis-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="emis-detail-head">
          <h2>{title}</h2>
          <button type="button" className="emis-action" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
