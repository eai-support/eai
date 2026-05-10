import React, {type ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Admonition from '@theme/Admonition';
import styles from './styles.module.css';

interface CardGridProps {
  readonly children: ReactNode;
}

interface LinkCardProps {
  readonly title: string;
  readonly href: string;
  readonly description?: string;
}

interface AsideProps {
  readonly children: ReactNode;
  readonly type?: 'note' | 'tip' | 'info' | 'warning' | 'danger';
  readonly title?: string;
}

interface StepsProps {
  readonly children: ReactNode;
}

export function CardGrid({children}: CardGridProps): React.JSX.Element {
  return <div className={styles.cardGrid}>{children}</div>;
}

export function LinkCard({
  title,
  href,
  description,
}: LinkCardProps): React.JSX.Element {
  return (
    <Link className={styles.cardLink} to={href}>
      <article className={styles.card}>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </article>
    </Link>
  );
}

export function Aside({
  children,
  type = 'note',
  title,
}: AsideProps): React.JSX.Element {
  return (
    <Admonition type={type} title={title}>
      {children}
    </Admonition>
  );
}

export function Steps({children}: StepsProps): React.JSX.Element {
  return <div className={styles.steps}>{children}</div>;
}
