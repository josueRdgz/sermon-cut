import { Button, type ButtonProps } from './Button';

type WithoutVariant<T> = T extends unknown ? Omit<T, 'variant'> : never;

export type PrimaryButtonProps = WithoutVariant<ButtonProps>;

export function PrimaryButton(props: PrimaryButtonProps) {
  return <Button {...(props as ButtonProps)} variant="primary" />;
}
