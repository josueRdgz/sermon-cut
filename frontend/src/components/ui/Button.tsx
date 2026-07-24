import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  fullWidth?: boolean;
  children?: ReactNode;
  className?: string;
}

type NativeButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & {
    to?: undefined;
    href?: undefined;
  };

type RouterLinkProps = CommonProps &
  Omit<LinkProps, keyof CommonProps> & { to: LinkProps['to'] };

type AnchorProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps> & { href: string };

export type ButtonProps = NativeButtonProps | RouterLinkProps | AnchorProps;

const ICON_SIZE: Record<ButtonSize, number> = { sm: 15, md: 17 };

function buildClassName({
  variant = 'primary',
  size = 'md',
  fullWidth,
  iconOnly,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  iconOnly: boolean;
  className?: string;
}): string {
  return [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth ? styles.fullWidth : '',
    iconOnly ? styles.iconOnly : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function Button(props: ButtonProps) {
  const {
    variant = 'primary',
    size = 'md',
    icon: Icon,
    iconRight: IconRight,
    fullWidth,
    children,
    className,
    ...rest
  } = props;

  const iconOnly = !children && (Boolean(Icon) || Boolean(IconRight));
  const classes = buildClassName({ variant, size, fullWidth, iconOnly, className });
  const iconSize = ICON_SIZE[size];

  const content = (
    <>
      {Icon ? <Icon size={iconSize} strokeWidth={2} aria-hidden /> : null}
      {children ? <span className={styles.label}>{children}</span> : null}
      {IconRight ? <IconRight size={iconSize} strokeWidth={2} aria-hidden /> : null}
    </>
  );

  if ('to' in props && props.to !== undefined) {
    const { to, ...linkRest } = rest as Omit<RouterLinkProps, keyof CommonProps>;
    return (
      <Link to={to} className={classes} {...linkRest}>
        {content}
      </Link>
    );
  }

  if ('href' in props && props.href !== undefined) {
    return (
      <a className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {content}
      </a>
    );
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button className={classes} type={buttonRest.type ?? 'button'} {...buttonRest}>
      {content}
    </button>
  );
}
