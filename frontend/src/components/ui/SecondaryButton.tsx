import { Button, type ButtonProps } from './Button';

type WithoutVariant<T> = T extends unknown ? Omit<T, 'variant'> : never;

export type SecondaryButtonProps = WithoutVariant<ButtonProps>;

export function SecondaryButton(props: SecondaryButtonProps) {
  return <Button {...(props as ButtonProps)} variant="secondary" />;
}
