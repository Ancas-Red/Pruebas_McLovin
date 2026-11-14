import type { ReactNode } from "react";

interface Props {
  index: string;
  title: string;
  note?: ReactNode;
  children: ReactNode;
}

export function Panel({ index, title, note, children }: Props) {
  return (
    <section className="panel">
      <header className="panel__head">
        <span className="panel__idx">{index}</span>
        <h2 className="panel__title">{title}</h2>
        {note ? <span className="panel__note">{note}</span> : null}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}
